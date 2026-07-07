import { describe, expect, it } from 'vitest';
import { jiraReadOnlyFetch } from '../apps/api/src/jira';

describe('Jira read-only invariant (non-negotiable)', () => {
  it('refuses any write method before a request is ever sent', async () => {
    // Casts simulate a future caller trying to sneak a write past the types.
    await expect(jiraReadOnlyFetch('http://example.test', {}, 'POST' as unknown as 'GET')).rejects.toThrow('jira_write_forbidden');
    await expect(jiraReadOnlyFetch('http://example.test', {}, 'PUT' as unknown as 'GET')).rejects.toThrow('jira_write_forbidden');
    await expect(jiraReadOnlyFetch('http://example.test', {}, 'DELETE' as unknown as 'GET')).rejects.toThrow('jira_write_forbidden');
  });
});
