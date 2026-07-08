import { describe, expect, it } from 'vitest';
import { assertReadOnly } from '../apps/api/src/github-read';

describe('GitHub connector is READ-ONLY (Zuub is never written to)', () => {
  it('allows plain read paths', () => {
    expect(() => assertReadOnly('orgs/zuub/repos?per_page=100')).not.toThrow();
    expect(() => assertReadOnly('repos/zuub/documentation/readme')).not.toThrow();
  });

  it('rejects any argument that could make gh api mutate', () => {
    for (const mutating of ['-X POST orgs/zuub/repos', 'repos/zuub/x --method PATCH', 'repos/zuub/x -f title=hi', '-F body=@x', 'repos/zuub/x --input payload.json']) {
      expect(() => assertReadOnly(mutating), mutating).toThrow(/github_write_forbidden/);
    }
  });
});
