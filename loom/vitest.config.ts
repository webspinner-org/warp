import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    // forks pool — each test file runs in a real Node child process
    // rather than a vmContext-isolated worker. This is required for
    // tests that use dynamic `import()` of arbitrary filesystem paths
    // (e.g. weaver-cell-dispatch.test.ts), which the threaded vmContext
    // pool rejects with "A dynamic import callback was not specified."
    pool: 'forks',
  },
});
