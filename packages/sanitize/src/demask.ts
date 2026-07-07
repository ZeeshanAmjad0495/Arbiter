import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ArbiterConfig } from '@arbiter/config';
import { ConfigError, type SanitizationFindingType } from '@arbiter/core';

/**
 * The de-masking store maps placeholders back to real values so an APPROVED,
 * reviewed output can be re-hydrated before it lands in Jira/TestRail. It is a
 * PII sink by definition, so the plan requires it be encrypted, access-controlled,
 * and retention-limited from day one (§8).
 *
 * Phase 0 scope: process-local storage. Access control is enforced at the
 * service boundary; a Postgres-backed, row-authorized store is a Phase 2 item.
 * Credentials are NEVER stored here — they hard-block upstream instead.
 */
export interface DemaskEntry {
  readonly type: SanitizationFindingType;
  readonly createdAtMs: number;
}

export interface DemaskStore {
  readonly mode: 'encrypted' | 'ephemeral';
  /**
   * Allocates a globally-unique placeholder for `original`, stores the reversible
   * mapping, and returns the placeholder. The counter lives in the (long-lived)
   * store, so placeholders never collide across sanitize() calls — a later call's
   * `[EMAIL_ADDRESS_n]` can't overwrite an earlier one and leak the wrong PII.
   */
  put(type: SanitizationFindingType, original: string): Promise<string>;
  resolve(placeholder: string): Promise<string | null>;
  /** Retention control — drop mappings older than the cutoff. Returns count removed. */
  purgeOlderThan(ageMs: number): Promise<number>;
  size(): number;
}

/** Plaintext, in-memory. Used when no encryption key is configured. */
class EphemeralDemaskStore implements DemaskStore {
  readonly mode = 'ephemeral' as const;
  private readonly map = new Map<string, { value: string; type: SanitizationFindingType; createdAtMs: number }>();
  private readonly counters = new Map<string, number>();

  private allocate(type: SanitizationFindingType): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return `[${type}_${n}]`;
  }

  async put(type: SanitizationFindingType, original: string): Promise<string> {
    const placeholder = this.allocate(type);
    this.map.set(placeholder, { value: original, type, createdAtMs: Date.now() });
    return placeholder;
  }
  async resolve(placeholder: string): Promise<string | null> {
    return this.map.get(placeholder)?.value ?? null;
  }
  async purgeOlderThan(ageMs: number): Promise<number> {
    const cutoff = Date.now() - ageMs;
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.createdAtMs < cutoff) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }
  size(): number {
    return this.map.size;
  }
}

/** AES-256-GCM encrypted values at rest (in memory). */
class EncryptedDemaskStore implements DemaskStore {
  readonly mode = 'encrypted' as const;
  private readonly map = new Map<string, { cipher: Buffer; type: SanitizationFindingType; createdAtMs: number }>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly key: Buffer) {}

  private allocate(type: SanitizationFindingType): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return `[${type}_${n}]`;
  }

  async put(type: SanitizationFindingType, original: string): Promise<string> {
    const placeholder = this.allocate(type);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(original, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.map.set(placeholder, { cipher: Buffer.concat([iv, tag, enc]), type, createdAtMs: Date.now() });
    return placeholder;
  }
  async resolve(placeholder: string): Promise<string | null> {
    const entry = this.map.get(placeholder);
    if (!entry) return null;
    const iv = entry.cipher.subarray(0, 12);
    const tag = entry.cipher.subarray(12, 28);
    const data = entry.cipher.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
  async purgeOlderThan(ageMs: number): Promise<number> {
    const cutoff = Date.now() - ageMs;
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.createdAtMs < cutoff) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }
  size(): number {
    return this.map.size;
  }
}

export function createDemaskStore(config: ArbiterConfig): DemaskStore {
  if (config.demask === 'encrypted') {
    const raw = config.env.ARBITER_DEMASK_KEY;
    if (!raw) throw new ConfigError('demask mode is encrypted but ARBITER_DEMASK_KEY is missing');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new ConfigError('ARBITER_DEMASK_KEY must be 32 bytes base64-encoded (openssl rand -base64 32)', {
        context: { got: key.length },
      });
    }
    return new EncryptedDemaskStore(key);
  }
  return new EphemeralDemaskStore();
}
