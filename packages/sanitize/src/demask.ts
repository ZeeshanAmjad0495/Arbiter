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
   *
   * `projectId` tenant-scopes the mapping: a scoped entry can only be resolved by
   * the same project (fail-closed), so rehydration can never leak another tenant's
   * PII. Omit it for unscoped (single-tenant / test) use.
   */
  put(type: SanitizationFindingType, original: string, projectId?: string): Promise<string>;
  /** Returns the original iff the entry is unscoped or its project matches `projectId`. */
  resolve(placeholder: string, projectId?: string): Promise<string | null>;
  /** Retention control — drop mappings older than the cutoff. Returns count removed. */
  purgeOlderThan(ageMs: number): Promise<number>;
  /**
   * Project-scoped retention — drop this project's mappings older than the cutoff.
   * This is the production retention path: it works even for the durable store
   * (whose global {@link purgeOlderThan} cannot run cross-project under RLS).
   */
  purgeProjectOlderThan(projectId: string, ageMs: number): Promise<number>;
  size(): number;
}

/** Fail-closed tenant check: a scoped entry is only visible to its own project. */
function tenantVisible(entryProjectId: string | undefined, callerProjectId: string | undefined): boolean {
  return entryProjectId === undefined || entryProjectId === callerProjectId;
}

/** AES-256-GCM: iv(12) || tag(16) || ciphertext. The only place plaintext PII is turned into bytes. */
function encrypt(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decrypt(key: Buffer, blob: Uint8Array): string {
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Durable storage port for {@link StoredDemaskStore}. Deals ONLY in ciphertext —
 * the store encrypts before calling `store` and decrypts after `getCipher`, so
 * the backing store (e.g. Postgres) never holds plaintext PII. Structurally
 * satisfied by @arbiter/db's DemaskRepository.
 */
export interface DemaskStorage {
  store(projectId: string, type: SanitizationFindingType, cipher: Uint8Array, createdAtMs: number): Promise<string>;
  getCipher(projectId: string, placeholder: string): Promise<{ cipher: Uint8Array; type: string } | null>;
  purgeOlderThan(projectId: string, cutoffMs: number): Promise<number>;
  count(projectId: string): Promise<number>;
}

/** Plaintext, in-memory. Used when no encryption key is configured. */
class EphemeralDemaskStore implements DemaskStore {
  readonly mode = 'ephemeral' as const;
  private readonly map = new Map<string, { value: string; type: SanitizationFindingType; createdAtMs: number; projectId?: string }>();
  private readonly counters = new Map<string, number>();

  private allocate(type: SanitizationFindingType): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return `[${type}_${n}]`;
  }

  async put(type: SanitizationFindingType, original: string, projectId?: string): Promise<string> {
    const placeholder = this.allocate(type);
    this.map.set(placeholder, { value: original, type, createdAtMs: Date.now(), ...(projectId ? { projectId } : {}) });
    return placeholder;
  }
  async resolve(placeholder: string, projectId?: string): Promise<string | null> {
    const entry = this.map.get(placeholder);
    if (!entry || !tenantVisible(entry.projectId, projectId)) return null;
    return entry.value;
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
  async purgeProjectOlderThan(projectId: string, ageMs: number): Promise<number> {
    const cutoff = Date.now() - ageMs;
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.projectId === projectId && v.createdAtMs < cutoff) {
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
  private readonly map = new Map<string, { cipher: Buffer; type: SanitizationFindingType; createdAtMs: number; projectId?: string }>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly key: Buffer) {}

  private allocate(type: SanitizationFindingType): string {
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    return `[${type}_${n}]`;
  }

  async put(type: SanitizationFindingType, original: string, projectId?: string): Promise<string> {
    const placeholder = this.allocate(type);
    this.map.set(placeholder, { cipher: encrypt(this.key, original), type, createdAtMs: Date.now(), ...(projectId ? { projectId } : {}) });
    return placeholder;
  }
  async resolve(placeholder: string, projectId?: string): Promise<string | null> {
    const entry = this.map.get(placeholder);
    if (!entry || !tenantVisible(entry.projectId, projectId)) return null;
    return decrypt(this.key, entry.cipher);
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
  async purgeProjectOlderThan(projectId: string, ageMs: number): Promise<number> {
    const cutoff = Date.now() - ageMs;
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.projectId === projectId && v.createdAtMs < cutoff) {
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

/**
 * AES-256-GCM at rest, ciphertext persisted via a {@link DemaskStorage} (Postgres).
 * Encryption/decryption stay in-process; the backing store never sees plaintext.
 * Durable and shared across restarts/instances — this is the deployment-grade vault.
 *
 * Every operation is project-scoped and FAIL-CLOSED: an unscoped put/resolve throws
 * rather than silently writing/reading a cross-tenant-visible mapping.
 */
class StoredDemaskStore implements DemaskStore {
  readonly mode = 'encrypted' as const;
  private puts = 0;

  constructor(
    private readonly key: Buffer,
    private readonly storage: DemaskStorage,
  ) {}

  async put(type: SanitizationFindingType, original: string, projectId?: string): Promise<string> {
    if (!projectId) throw new ConfigError('durable de-mask store requires a projectId (refusing to persist an unscoped PII mapping)');
    const placeholder = await this.storage.store(projectId, type, encrypt(this.key, original), Date.now());
    this.puts++;
    return placeholder;
  }
  async resolve(placeholder: string, projectId?: string): Promise<string | null> {
    if (!projectId) return null; // fail-closed: no cross-tenant resolution
    const entry = await this.storage.getCipher(projectId, placeholder);
    return entry ? decrypt(this.key, entry.cipher) : null;
  }
  async purgeOlderThan(ageMs: number): Promise<number> {
    // The GLOBAL purge can't run cross-project under RLS (each tenant needs its own
    // GUC). Callers use purgeProjectOlderThan — the real, project-scoped path.
    void ageMs;
    return 0;
  }
  async purgeProjectOlderThan(projectId: string, ageMs: number): Promise<number> {
    return this.storage.purgeOlderThan(projectId, Date.now() - ageMs);
  }
  size(): number {
    return this.puts; // best-effort: puts made by THIS process (durable count is per-project)
  }
}

function demaskKey(config: ArbiterConfig): Buffer {
  const raw = config.env.ARBITER_DEMASK_KEY;
  if (!raw) throw new ConfigError('demask mode is encrypted but ARBITER_DEMASK_KEY is missing');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigError('ARBITER_DEMASK_KEY must be 32 bytes base64-encoded (openssl rand -base64 32)', { context: { got: key.length } });
  }
  return key;
}

/**
 * Chooses the de-mask store. When a durable `storage` is supplied AND encryption
 * is configured, mappings persist (encrypted) to it; otherwise falls back to the
 * process-local encrypted/ephemeral stores. A durable store without an encryption
 * key is refused — we never persist a PII sink unencrypted.
 */
export function createDemaskStore(config: ArbiterConfig, storage?: DemaskStorage): DemaskStore {
  if (config.demask === 'encrypted') {
    const key = demaskKey(config);
    return storage ? new StoredDemaskStore(key, storage) : new EncryptedDemaskStore(key);
  }
  return new EphemeralDemaskStore();
}
