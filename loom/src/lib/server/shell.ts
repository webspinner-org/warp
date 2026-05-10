// Shell capability — the Weaver's gated interface for Spinners that
// need to invoke host processes.
//
// Operating model (canon-aligned, v0.1):
//
//   - A Spinner declares `shellAllowlist: string[]` in its manifest.
//     Only the top-level commands listed (e.g. "brew", "node") may run.
//   - The Weaver's `dispatch*` for that Spinner constructs a
//     `ShellRunner` keyed to the manifest's allowlist and passes it
//     down to the handler.
//   - The runner rejects any command not in the allowlist; logs the
//     attempt; refuses shell-expansion (always spawn with args, never
//     a shell string); enforces a default timeout and an output cap.
//
// What v0.1 does *not* do:
//
//   - Per-capability sub-allowlists (e.g. `provisionToolchain` may run
//     `brew --version` but not `brew install`). Future revision.
//   - Containerised sandboxing (firejail / macOS sandbox-exec).
//   - Resource limits beyond timeout + output cap.
//
// The contract is conservative: an allowlist-by-binary is enough
// to keep Spinners from arbitrary shell access. Tightening to
// per-capability subcommand allowlists comes when the first Spinner
// needs the distinction (logged in OPEN_QUESTIONS.md).

import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB per stream
const HOME = process.env['HOME'] ?? '/';

export interface ShellRunRequest {
  /** Top-level command to invoke — must be in the Spinner's allowlist. */
  readonly command: string;
  /** Arguments. Never interpreted by a shell; passed directly to spawn. */
  readonly args?: readonly string[];
  /** Working directory. Defaults to $HOME. Restricted to $HOME or below. */
  readonly cwd?: string;
  /** Override env variables. Inherits process.env by default. */
  readonly env?: Readonly<Record<string, string>>;
  /** Timeout in ms. Defaults to 30 s. Hard cap 5 min. */
  readonly timeoutMs?: number;
}

export interface ShellRunResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export class ShellPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellPermissionError';
  }
}

export interface ShellRunner {
  run(req: ShellRunRequest): Promise<ShellRunResult>;
  readonly allowlist: readonly string[];
}

/**
 * Build a shell runner for a Spinner with the given allowlist.
 * The returned `run` function refuses any command not in the
 * allowlist with a `ShellPermissionError`.
 */
export function createShellRunner(allowlist: readonly string[]): ShellRunner {
  const allowed = new Set(allowlist);
  return {
    allowlist,
    async run(req: ShellRunRequest): Promise<ShellRunResult> {
      if (!allowed.has(req.command)) {
        throw new ShellPermissionError(
          `Shell command "${req.command}" is not in the Spinner's allowlist. Declare it in manifest.json#shellAllowlist.`,
        );
      }

      // Resolve and constrain cwd to $HOME or below.
      const cwdRaw = req.cwd ?? HOME;
      const cwdResolved = resolvePath(cwdRaw);
      const homeResolved = resolvePath(HOME);
      if (!cwdResolved.startsWith(homeResolved)) {
        throw new ShellPermissionError(
          `cwd must be inside $HOME. Got: ${cwdResolved} (HOME: ${homeResolved}).`,
        );
      }

      const timeoutMs = Math.min(
        Math.max(1_000, req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        5 * 60 * 1_000,
      );

      const args = [...(req.args ?? [])];
      const t0 = Date.now();

      return await new Promise<ShellRunResult>((resolve) => {
        const child = spawn(req.command, args, {
          cwd: cwdResolved,
          env: { ...process.env, ...(req.env ?? {}) },
          // No shell — args are passed directly, no expansion, no
          // injection via embedded quotes/semicolons.
          shell: false,
          // Detach false so we can kill the whole process group on timeout.
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 1_000);
        }, timeoutMs);

        child.stdout?.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += chunk.toString('utf8', 0, Math.min(chunk.length, MAX_OUTPUT_BYTES - stdout.length));
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += chunk.toString('utf8', 0, Math.min(chunk.length, MAX_OUTPUT_BYTES - stderr.length));
          }
        });

        const finalize = (exitCode: number | null, signal: NodeJS.Signals | null) => {
          clearTimeout(timer);
          resolve({
            command: req.command,
            args,
            cwd: cwdResolved,
            exitCode,
            signal,
            stdout,
            stderr,
            durationMs: Date.now() - t0,
            timedOut,
          });
        };

        child.on('error', (err) => {
          stderr += `\n[spawn error] ${err.message}`;
          finalize(127, null);
        });
        child.on('close', (code, signal) => finalize(code, signal));
      });
    },
  };
}
