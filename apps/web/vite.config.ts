import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Dev server proxies API calls to the Arbiter API (single-origin in the browser).
const API = process.env.ARBITER_API_ORIGIN ?? 'http://localhost:4310';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    proxy: {
      '/v1': API,
      '/api': API,
      '/health': API,
    },
  },
});
