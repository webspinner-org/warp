import { describe, it, expect } from 'vitest';
import { createShellRunner, ShellPermissionError } from './shell.js';

describe('shell capability', () => {
  it('refuses commands outside the allowlist', async () => {
    const runner = createShellRunner(['echo']);
    await expect(runner.run({ command: 'rm', args: ['-rf', '/'] })).rejects.toThrow(
      ShellPermissionError,
    );
  });

  it('allows commands in the allowlist', async () => {
    const runner = createShellRunner(['echo']);
    const r = await runner.run({ command: 'echo', args: ['hello', 'cell'] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello cell');
  });

  it('rejects cwd outside $HOME', async () => {
    const runner = createShellRunner(['echo']);
    await expect(runner.run({ command: 'echo', args: ['hi'], cwd: '/etc' })).rejects.toThrow(
      ShellPermissionError,
    );
  });

  it('captures non-zero exit codes', async () => {
    const runner = createShellRunner(['false']);
    const r = await runner.run({ command: 'false', args: [] });
    expect(r.exitCode).not.toBe(0);
  });

  it('does NOT invoke a shell — no command injection via args', async () => {
    // If shell were invoked, `echo $HOME; rm -rf x` would expand $HOME and
    // execute two commands. Because shell:false, the args are literal and
    // get printed verbatim.
    const runner = createShellRunner(['echo']);
    const r = await runner.run({
      command: 'echo',
      args: ['$HOME', ';', 'rm', '-rf', 'whatever'],
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('$HOME ; rm -rf whatever');
  });

  it('times out long-running commands', async () => {
    const runner = createShellRunner(['sleep']);
    const r = await runner.run({ command: 'sleep', args: ['5'], timeoutMs: 1_000 });
    expect(r.timedOut).toBe(true);
  });
});
