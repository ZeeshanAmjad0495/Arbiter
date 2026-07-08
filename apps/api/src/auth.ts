import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type PublicUser, Session, type UserId, User, type UserRole, newSessionId, newUserId, toPublicUser } from '@arbiter/core';
import type { RepositoryBundle } from '@arbiter/db';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Opaque, URL-safe tokens (session + access key). High entropy → hashing for lookup is enough. */
const genToken = (): string => randomBytes(32).toString('base64url');
const genKey = (): string => `ak_${randomBytes(24).toString('base64url')}`;

/** Constant-time compare of two hex hashes. */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

export class AuthService {
  constructor(
    private readonly repos: RepositoryBundle,
    private readonly sessionTtlMs: number,
  ) {}

  /**
   * Issue (or rotate) an access key for an email, creating the user if missing.
   * Returns the PLAINTEXT key — the caller emails it; only its hash is stored.
   */
  async issueKey(email: string, role: UserRole = 'qa'): Promise<{ user: PublicUser; key: string }> {
    const existing = await this.repos.users.getByEmail(email);
    const key = genKey();
    const user = User.parse({
      id: existing?.id ?? newUserId(),
      email,
      role: existing?.role ?? role,
      accessKeyHash: sha256(key),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    await this.repos.users.upsert(user);
    return { user: toPublicUser(user), key };
  }

  /** Verify email + key, create a session, and return the session token + expiry. */
  async login(email: string, key: string): Promise<LoginResult | null> {
    const user = await this.repos.users.getByEmail(email);
    // Do the hash compare regardless of user existence to avoid an email-enumeration timing oracle.
    const expected = user?.accessKeyHash ?? sha256(genToken());
    const ok = hashEquals(expected, sha256(key));
    if (!user || !user.accessKeyHash || !ok) return null;

    const token = genToken();
    const now = Date.now();
    const session = Session.parse({
      id: newSessionId(),
      userId: user.id,
      tokenHash: sha256(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlMs).toISOString(),
    });
    await this.repos.sessions.create(session);
    return { token, expiresAt: session.expiresAt, user: toPublicUser(user) };
  }

  /**
   * Step-up re-auth: confirm the given access key belongs to `userId`. Used to
   * gate destructive actions (re-enter your key to confirm). Constant-time compare;
   * always hashes even when the user/hash is missing to avoid a timing oracle.
   */
  async verifyKey(userId: UserId, key: string): Promise<boolean> {
    const user = await this.repos.users.get(userId);
    const expected = user?.accessKeyHash ?? sha256(genToken());
    const ok = hashEquals(expected, sha256(key));
    return Boolean(user?.accessKeyHash) && ok;
  }

  /** Resolve the current user from a session token; null if missing/expired (expired sessions are pruned). */
  async authenticate(token: string): Promise<{ user: PublicUser; userId: UserId } | null> {
    if (!token) return null;
    const session = await this.repos.sessions.getByTokenHash(sha256(token));
    if (!session) return null;
    if (session.expiresAt < new Date().toISOString()) {
      await this.repos.sessions.delete(session.id);
      return null;
    }
    const user = await this.repos.users.get(session.userId);
    if (!user) return null;
    return { user: toPublicUser(user), userId: user.id };
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    const session = await this.repos.sessions.getByTokenHash(sha256(token));
    if (session) await this.repos.sessions.delete(session.id);
  }
}
