import { describe, it, expect, vi } from 'vitest';
import type { SpinnerName } from '@webspinner-foundation/sdk';
import {
  createOutboundFetcher,
  OutboundConfigError,
  OutboundPermissionError,
  type OutboundFetchMeta,
} from './outbound.js';

const SPINNER = '@webspinner-foundation/test-fixture' as SpinnerName;

function mockResponse(opts: {
  url?: string;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const body = opts.body ?? '';
  const headers = new Headers(opts.headers ?? { 'content-type': 'text/plain' });
  return new Response(body, {
    status: opts.status ?? 200,
    headers,
  });
}

describe('outbound capability', () => {
  it('refuses hosts outside the allowlist', async () => {
    const calls: OutboundFetchMeta[] = [];
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: vi.fn(),
    });
    await expect(fetcher.fetch({ url: 'https://evil.example/leak' })).rejects.toBeInstanceOf(
      OutboundPermissionError,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.outcome).toBe('denied');
    expect(calls[0]?.errorKind).toBe('host-not-allowlisted');
  });

  it('allows hosts in the allowlist', async () => {
    const calls: OutboundFetchMeta[] = [];
    const impl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(mockResponse({ body: 'hello cell' }));
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: impl,
    });
    const res = await fetcher.fetch({ url: 'https://en.wikipedia.org/wiki/Bookkeeping' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello cell');
    expect(res.ok).toBe(true);
    expect(impl).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.outcome).toBe('success');
    expect(calls[0]?.status).toBe(200);
  });

  it('rejects malformed allowlist entries at construction', () => {
    expect(() =>
      createOutboundFetcher(['https://en.wikipedia.org'], { spinnerId: SPINNER }),
    ).toThrow(OutboundConfigError);
    expect(() => createOutboundFetcher(['en.wikipedia.org/wiki'], { spinnerId: SPINNER })).toThrow(
      OutboundConfigError,
    );
    expect(() => createOutboundFetcher(['localhost'], { spinnerId: SPINNER })).toThrow(
      OutboundConfigError,
    );
    expect(() => createOutboundFetcher(['*.wikipedia.org'], { spinnerId: SPINNER })).toThrow(
      OutboundConfigError,
    );
  });

  it('rejects malformed URLs at fetch time', async () => {
    const calls: OutboundFetchMeta[] = [];
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: vi.fn(),
    });
    await expect(fetcher.fetch({ url: 'not a url' })).rejects.toBeInstanceOf(
      OutboundPermissionError,
    );
    expect(calls[0]?.errorKind).toBe('url-parse-failed');
  });

  it('refuses non-http/https schemes', async () => {
    const calls: OutboundFetchMeta[] = [];
    const fetcher = createOutboundFetcher(['evil.example'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: vi.fn(),
    });
    await expect(fetcher.fetch({ url: 'file:///etc/passwd' })).rejects.toBeInstanceOf(
      OutboundPermissionError,
    );
    expect(calls[0]?.errorKind).toBe('scheme-not-allowed');
  });

  it('truncates response bodies past the byte cap', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024); // 2 MB
    const impl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(mockResponse({ body: huge }));
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      fetchImpl: impl,
    });
    const res = await fetcher.fetch({ url: 'https://en.wikipedia.org/big' });
    expect(res.truncated).toBe(true);
    expect(res.bytesRead).toBe(1024 * 1024);
    expect(res.text.length).toBe(1024 * 1024);
  });

  it('captures status and headers on non-2xx responses without throwing', async () => {
    const impl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      mockResponse({
        status: 404,
        body: '{"error":"missing"}',
        headers: { 'X-Trace-Id': 'abc' },
      }),
    );
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      fetchImpl: impl,
    });
    const res = await fetcher.fetch({ url: 'https://en.wikipedia.org/missing' });
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.headers['x-trace-id']).toBe('abc');
    expect(res.text).toContain('missing');
  });

  it('refuses bodies larger than the request cap', async () => {
    const calls: OutboundFetchMeta[] = [];
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: vi.fn(),
    });
    const huge = 'x'.repeat(64 * 1024 + 1);
    await expect(
      fetcher.fetch({ url: 'https://en.wikipedia.org/post', method: 'POST', body: huge }),
    ).rejects.toBeInstanceOf(OutboundPermissionError);
    expect(calls[0]?.errorKind).toBe('body-too-large');
  });

  it('aborts on timeout and records error outcome', async () => {
    const calls: OutboundFetchMeta[] = [];
    const impl: typeof globalThis.fetch = (_url, init) =>
      new Promise((_, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: (m) => {
        calls.push(m);
      },
      fetchImpl: impl,
    });
    await expect(
      fetcher.fetch({ url: 'https://en.wikipedia.org/slow', timeoutMs: 600 }),
    ).rejects.toThrow();
    expect(calls[0]?.outcome).toBe('error');
    expect(calls[0]?.errorKind).toBe('timeout');
  });

  it('passes method, headers, and body to the underlying fetch', async () => {
    const impl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(mockResponse({ body: 'ok' }));
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      fetchImpl: impl,
    });
    await fetcher.fetch({
      url: 'https://en.wikipedia.org/post',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"cell"}',
    });
    const [, init] = impl.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"hello":"cell"}');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('survives onCall callbacks that throw', async () => {
    const impl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(mockResponse({ body: 'ok' }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = createOutboundFetcher(['en.wikipedia.org'], {
      spinnerId: SPINNER,
      onCall: () => {
        throw new Error('audit emitter down');
      },
      fetchImpl: impl,
    });
    const res = await fetcher.fetch({ url: 'https://en.wikipedia.org/x' });
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
