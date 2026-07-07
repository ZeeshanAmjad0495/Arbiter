import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA: build to static assets Fastify serves in prod; SSR disabled in +layout.ts.
    adapter: adapter({ fallback: 'index.html' }),
  },
};
