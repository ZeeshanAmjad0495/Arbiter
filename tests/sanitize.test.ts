import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { createDemaskStore, createSanitizer, luhnValid } from '@arbiter/sanitize';

const offline = loadConfig({});

describe('sanitizer (regex engine)', () => {
  const sanitizer = createSanitizer(offline);

  it('redacts PII and keeps originals out of the sanitized text', async () => {
    const report = await sanitizer.sanitize('Contact john.doe@example.com, SSN 123-45-6789, member MEM123456.');
    expect(report.blocked).toBe(false);
    const types = report.findings.map((f) => f.type);
    expect(types).toContain('EMAIL_ADDRESS');
    expect(types).toContain('US_SSN');
    expect(types).toContain('MEMBER_ID');
    expect(report.sanitizedText).not.toContain('john.doe@example.com');
    expect(report.sanitizedText).not.toContain('123-45-6789');
    expect(report.sanitizedText).toContain('[EMAIL_ADDRESS_1]');
  });

  it('hard-blocks on a live secret and never persists it', async () => {
    const report = await sanitizer.sanitize('deploy with key sk-ABCDEF0123456789ABCDEF now');
    expect(report.blocked).toBe(true);
    expect(report.blockReasons.length).toBeGreaterThan(0);
    expect(report.sanitizedText).not.toContain('sk-ABCDEF0123456789ABCDEF');
    // Credential placeholder must not be resolvable from the de-masking store.
    expect(await sanitizer.demask.resolve('[API_KEY_REDACTED]')).toBeNull();
  });

  it('uses Luhn to reject false-positive card numbers', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('hard-blocks a secret embedded in a URL (no engulfing-match bypass)', async () => {
    // Regression: an INTERNAL_URL that engulfs a JWT in its query string must not
    // suppress the credential match and let the secret through / get stored.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const report = await sanitizer.sanitize(`See https://logs.internal.corp/t?token=${jwt}`);
    expect(report.blocked).toBe(true);
    expect(report.blockReasons.length).toBeGreaterThan(0);
    expect(report.sanitizedText).not.toContain(jwt);
    expect(report.sanitizedText).not.toContain('eyJhbGci');
  });
});

describe('de-masking store', () => {
  it('encrypts and round-trips PII mappings', async () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const store = createDemaskStore(loadConfig({ ARBITER_DEMASK_KEY: key }));
    expect(store.mode).toBe('encrypted');
    const placeholder = await store.put('EMAIL_ADDRESS', 'john.doe@example.com');
    expect(await store.resolve(placeholder)).toBe('john.doe@example.com');
    expect(await store.resolve('[UNKNOWN]')).toBeNull();
  });

  it('allocates unique placeholders so repeated puts never collide (no cross-request PII leak)', async () => {
    const store = createDemaskStore(loadConfig({}));
    const p1 = await store.put('EMAIL_ADDRESS', 'alice@example.com');
    const p2 = await store.put('EMAIL_ADDRESS', 'bob@example.com');
    expect(p1).not.toBe(p2);
    expect(await store.resolve(p1)).toBe('alice@example.com');
    expect(await store.resolve(p2)).toBe('bob@example.com');
  });

  it('purges entries older than the retention cutoff', async () => {
    const store = createDemaskStore(loadConfig({}));
    await store.put('EMAIL_ADDRESS', 'a@b.com');
    expect(store.size()).toBe(1);
    expect(await store.purgeOlderThan(-1)).toBe(1); // cutoff in the future -> removes all
    expect(store.size()).toBe(0);
  });
});
