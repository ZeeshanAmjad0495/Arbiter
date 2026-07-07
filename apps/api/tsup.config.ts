import { defineConfig } from 'tsup';

// Bundles the app + its workspace deps into a single runnable file for the
// container image (no need to ship the whole monorepo).
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@arbiter\//],
});
