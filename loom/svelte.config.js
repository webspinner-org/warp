import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Node adapter — built bundle runs as `node build/index.js` on Kepler.
    // No public hostname during bootstrap; reached over LAN and tailnet.
    adapter: adapter(),
  },
};

export default config;
