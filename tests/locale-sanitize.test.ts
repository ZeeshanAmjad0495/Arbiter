import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { createSanitizer } from '@arbiter/sanitize';

/**
 * Locale-aware PII recognizers (component hardening). Well-anchored + validated so
 * ordinary text is not over-redacted, while non-US member data (IBAN, international
 * phone, UK NINO) is caught before it can reach the model.
 */
describe('locale-aware PII recognizers', () => {
  const sanitizer = createSanitizer(loadConfig({}));
  const types = async (text: string) => (await sanitizer.sanitize(text)).findings.map((f) => f.type);

  it('detects an IBAN', async () => {
    expect(await types('Please pay account IBAN GB29 NWBK 6016 1331 9268 19 by Friday.')).toContain('OTHER');
  });

  it('detects an international (E.164) phone number', async () => {
    expect(await types('Call the member on +44 20 7946 0958 tomorrow.')).toContain('PHONE_NUMBER');
  });

  it('detects a UK National Insurance number', async () => {
    expect(await types('Their NINO is AB123456C per the record.')).toContain('OTHER');
  });

  it('redacts the IBAN from the sanitized output', async () => {
    const report = await sanitizer.sanitize('IBAN GB29 NWBK 6016 1331 9268 19');
    expect(report.sanitizedText).not.toContain('NWBK');
    expect(report.sanitizedText).not.toContain('9268');
  });

  it('does not over-flag ordinary text as locale PII', async () => {
    const t = await types('The meeting is at 10am in room 4B to review Q1 goals and TC-40.');
    expect(t).not.toContain('OTHER');
    expect(t).not.toContain('PHONE_NUMBER');
  });
});
