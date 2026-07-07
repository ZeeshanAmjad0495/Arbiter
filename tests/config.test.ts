import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';

describe('config', () => {
  it('treats a blank optional URL ("") as unset instead of throwing', () => {
    const cfg = loadConfig({ JIRA_BASE_URL: '', DATABASE_URL: '', PRESIDIO_ANALYZER_URL: '' });
    expect(cfg.jira.configured).toBe(false);
    expect(cfg.persistence).toBe('memory');
  });

  it('enables Jira only when base URL + email + token are all set', () => {
    expect(loadConfig({ JIRA_BASE_URL: 'https://team.atlassian.net', JIRA_EMAIL: 'a@b.com' }).jira.configured).toBe(false);
    expect(
      loadConfig({ JIRA_BASE_URL: 'https://team.atlassian.net', JIRA_EMAIL: 'a@b.com', JIRA_API_TOKEN: 't' }).jira.configured,
    ).toBe(true);
  });

  it('still rejects a malformed (non-empty) URL', () => {
    expect(() => loadConfig({ JIRA_BASE_URL: 'not-a-url' })).toThrow();
  });
});
