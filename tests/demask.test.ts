import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { createDemaskStore } from '@arbiter/sanitize';

const KEY = randomBytes(32).toString('base64');

describe('de-mask store tenant-scoping (fail-closed cross-tenant)', () => {
  for (const mode of ['ephemeral', 'encrypted'] as const) {
    it(`${mode}: a scoped mapping resolves only for its own project`, async () => {
      const store = createDemaskStore(loadConfig(mode === 'encrypted' ? { ARBITER_DEMASK_KEY: KEY } : {}));
      expect(store.mode).toBe(mode);

      const ph = await store.put('EMAIL_ADDRESS', 'jane@example.com', 'project-A');
      expect(await store.resolve(ph, 'project-A')).toBe('jane@example.com'); // same project
      expect(await store.resolve(ph, 'project-B')).toBeNull(); // other project → fail closed
      expect(await store.resolve(ph)).toBeNull(); // no project on a scoped entry → fail closed
    });
  }

  it('an unscoped mapping stays resolvable (backward compatible)', async () => {
    const store = createDemaskStore(loadConfig({}));
    const ph = await store.put('EMAIL_ADDRESS', 'jane@example.com');
    expect(await store.resolve(ph)).toBe('jane@example.com');
    expect(await store.resolve(ph, 'any-project')).toBe('jane@example.com');
  });
});
