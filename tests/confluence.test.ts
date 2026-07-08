import { describe, expect, it } from 'vitest';
import { confluenceReadOnlyFetch, storageToText } from '../apps/api/src/confluence';

describe('Confluence read-only connector', () => {
  it('is READ-ONLY — refuses any write method before a request is sent', async () => {
    // @ts-expect-error — deliberately passing a forbidden method to prove the guard
    await expect(confluenceReadOnlyFetch('https://x/wiki', {}, 'POST')).rejects.toThrow(/confluence_write_forbidden/);
    // @ts-expect-error
    await expect(confluenceReadOnlyFetch('https://x/wiki', {}, 'DELETE')).rejects.toThrow(/read-only/);
  });

  it('flattens Confluence storage format to grounding-ready text', () => {
    const html =
      '<h1>Eligibility</h1><p>Member <strong>MEM-123</strong> maps to <code>coverage_status</code>.</p>' +
      '<ul><li>Active</li><li>Lapsed</li></ul><p>See REQ-101 &amp; REQ-102.</p>';
    const text = storageToText(html);
    expect(text).toContain('Eligibility');
    expect(text).toContain('MEM-123');
    expect(text).toContain('coverage_status');
    expect(text).toContain('REQ-101 & REQ-102'); // entity decoded
    expect(text).not.toMatch(/<[^>]+>/); // no tags survive
  });
});
