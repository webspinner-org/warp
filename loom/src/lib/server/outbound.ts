// Outbound capability — the Weaver's gated interface for Spinners that
// need to reach external HTTP endpoints (e.g. research-class Spinners
// that consult credible public references before proposing an artifact).
//
// Operating model (canon-aligned, v0.1) — mirrors `shell.ts`:
//
//   - A Spinner declares `outboundAllowlist: string[]` in its manifest.
//     Only URLs whose host appears in the list may be fetched.
//   - The Weaver's `dispatch*` for that Spinner constructs an
//     `OutboundFetcher` keyed to the manifest's allowlist and passes it
//     down to the handler as `context.fetch`.
//   - The fetcher refuses any URL whose host is not in the allowlist;
//     fires an `onCall` callback per attempt (the dispatcher emits the
//     canonical `wp.spinner.outbound.fetch` audit event from there);
//     enforces a default timeout + response-byte cap; never logs the
//     response body, only its byte count.
//
// What v0.1 does *not* do:
//
//   - Wildcards / subdomain expansion (`*.wikipedia.org`). Hosts are
//     literal.
//   - Per-capability sub-allowlists.
//   - Egress IP allowlisting (DNS rebinding defence). Future revision.
//   - Cookie persistence across calls. Each call is stateless.
//
// The contract is conservative: an allowlist-by-host is enough to
// prevent unintended exfiltration and to make the Spinner's outbound
// dependencies visible in the manifest. Tightening to per-capability
// sub-allowlists or wildcards comes when the first Spinner needs the
// distinction (will be logged in OPEN_QUESTIONS.md when it does).

import type {
  SpinnerFetchRequest,
  SpinnerFetchResponse,
  SpinnerName,
} from '@webspinner-foundation/sdk';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const MAX_BODY_BYTES = 64 * 1024; // 64 KB outbound request body
const HOSTNAME_REGEX =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class OutboundPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundPermissionError';
  }
}

export class OutboundConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundConfigError';
  }
}

/**
 * Per-call metadata the fetcher passes to its `onCall` callback (the
 * dispatcher's audit-emission hook). One call → one event; the
 * dispatcher decides the CloudEvents shape from these fields.
 */
export interface OutboundFetchMeta {
  readonly url: string;
  readonly host: string;
  readonly method: string;
  /** 'success' for any completed HTTP exchange (including non-2xx).
   * 'denied' for permission failures (host not allowlisted, URL parse
   * failed). 'error' for network / timeout / other runtime failures. */
  readonly outcome: 'success' | 'denied' | 'error';
  readonly status?: number;
  readonly durationMs?: number;
  readonly responseBytes?: number;
  readonly errorKind?: string;
}

export interface OutboundFetcher {
  fetch(req: SpinnerFetchRequest): Promise<SpinnerFetchResponse>;
  readonly allowlist: readonly string[];
}

export interface OutboundFetcherOptions {
  /** Identity recorded in OutboundFetchMeta for audit correlation. */
  readonly spinnerId: SpinnerName;
  /**
   * Per-call callback the dispatcher uses to emit the canonical
   * `wp.spinner.outbound.fetch` audit event. The callback is `await`-ed
   * but its errors are caught and logged — they never affect the
   * fetch result the Spinner sees.
   */
  readonly onCall?: (meta: OutboundFetchMeta) => Promise<void> | void;
  /**
   * Override for the underlying fetch implementation. Defaults to
   * `globalThis.fetch`. Tests inject a mock here.
   */
  readonly fetchImpl?: typeof globalThis.fetch;
}

function lowerCaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Build an outbound fetcher for a Spinner with the given allowlist.
 * Validates the allowlist at construction (throws OutboundConfigError on
 * malformed hostnames) so manifest drift surfaces at dispatcher build
 * time, not deep inside a capability invocation.
 */
export function createOutboundFetcher(
  allowlist: readonly string[],
  options: OutboundFetcherOptions,
): OutboundFetcher {
  for (const host of allowlist) {
    if (!HOSTNAME_REGEX.test(host)) {
      throw new OutboundConfigError(
        `outboundAllowlist entry "${host}" is not a valid DNS hostname (lowercase labels, at least two, no scheme/path/port/wildcard).`,
      );
    }
  }
  const allowed = new Set(allowlist);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const { onCall } = options;

  async function emit(meta: OutboundFetchMeta): Promise<void> {
    if (onCall === undefined) return;
    try {
      await onCall(meta);
    } catch (err) {
      // Audit emission must never break the call. The dispatcher
      // already separates audit-write failures from capability
      // execution failures; we log here as a last resort.
      console.error('outbound onCall callback threw:', err);
    }
  }

  return {
    allowlist,
    async fetch(req: SpinnerFetchRequest): Promise<SpinnerFetchResponse> {
      const method = req.method ?? 'GET';

      // ── URL parse ────────────────────────────────────────────────
      let parsed: URL;
      try {
        parsed = new URL(req.url);
      } catch {
        await emit({
          url: req.url,
          host: '',
          method,
          outcome: 'denied',
          errorKind: 'url-parse-failed',
        });
        throw new OutboundPermissionError(`outbound URL "${req.url}" is not a valid URL.`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        await emit({
          url: req.url,
          host: parsed.host,
          method,
          outcome: 'denied',
          errorKind: 'scheme-not-allowed',
        });
        throw new OutboundPermissionError(
          `outbound URL "${req.url}" uses scheme "${parsed.protocol}"; only http and https are allowed.`,
        );
      }
      const host = parsed.hostname.toLowerCase();
      if (!allowed.has(host)) {
        await emit({
          url: req.url,
          host,
          method,
          outcome: 'denied',
          errorKind: 'host-not-allowlisted',
        });
        throw new OutboundPermissionError(
          `outbound host "${host}" is not in the Spinner's outboundAllowlist. Declare it in manifest.json#outboundAllowlist.`,
        );
      }

      // ── body discipline ──────────────────────────────────────────
      if (req.body !== undefined && req.body.length > MAX_BODY_BYTES) {
        await emit({
          url: req.url,
          host,
          method,
          outcome: 'denied',
          errorKind: 'body-too-large',
        });
        throw new OutboundPermissionError(
          `outbound body is ${req.body.length} bytes; max is ${MAX_BODY_BYTES}.`,
        );
      }

      // ── timeout ──────────────────────────────────────────────────
      const timeoutMs = Math.min(
        Math.max(MIN_TIMEOUT_MS, req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        MAX_TIMEOUT_MS,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const t0 = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(req.url, {
          method,
          headers: req.headers as HeadersInit | undefined,
          body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (err) {
        clearTimeout(timer);
        const errorKind = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
        await emit({
          url: req.url,
          host,
          method,
          outcome: 'error',
          durationMs: Date.now() - t0,
          errorKind,
        });
        throw err;
      }
      clearTimeout(timer);

      // ── read body with byte cap ─────────────────────────────────
      let text: string;
      let bytesRead: number;
      let truncated = false;
      try {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > MAX_RESPONSE_BYTES) {
          truncated = true;
          bytesRead = MAX_RESPONSE_BYTES;
          text = new TextDecoder('utf-8').decode(buf.slice(0, MAX_RESPONSE_BYTES));
        } else {
          bytesRead = buf.byteLength;
          text = new TextDecoder('utf-8').decode(buf);
        }
      } catch (err) {
        await emit({
          url: req.url,
          host,
          method,
          outcome: 'error',
          status: response.status,
          durationMs: Date.now() - t0,
          errorKind: 'body-read-failed',
        });
        throw err;
      }

      const durationMs = Date.now() - t0;
      await emit({
        url: req.url,
        host,
        method,
        outcome: 'success',
        status: response.status,
        durationMs,
        responseBytes: bytesRead,
      });

      return {
        url: response.url || req.url,
        status: response.status,
        ok: response.ok,
        headers: lowerCaseHeaders(response.headers),
        text,
        durationMs,
        bytesRead,
        truncated,
      };
    },
  };
}
