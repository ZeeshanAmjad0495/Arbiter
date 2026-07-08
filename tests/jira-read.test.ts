import { describe, expect, it } from 'vitest';
import { adfToText, jiraSiteReadOnlyFetch } from '../apps/api/src/jira-read';

const site = { baseUrl: 'https://example.atlassian.net', email: 'x@y.com', token: 'tok' };

describe('Jira connector is READ-ONLY (workspaces are never written to)', () => {
  it('refuses any write method before a request is sent', async () => {
    // @ts-expect-error — deliberately passing a forbidden method to prove the guard
    await expect(jiraSiteReadOnlyFetch(site, '/rest/api/3/issue', 'POST')).rejects.toThrow(/jira_write_forbidden/);
    // @ts-expect-error
    await expect(jiraSiteReadOnlyFetch(site, '/x', 'PUT')).rejects.toThrow(/read-only/);
  });

  it('flattens Atlassian Document Format to plain text', () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claim ' }, { type: 'text', text: 'CL-42 failed' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'retry needed' }] }] };
    const text = adfToText(adf);
    expect(text).toContain('Claim CL-42 failed');
    expect(text).toContain('retry needed');
    expect(adfToText('plain string')).toBe('plain string');
    expect(adfToText(null)).toBe('');
  });
});
