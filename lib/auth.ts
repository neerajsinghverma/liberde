// Multi-user auth: scrypt password hashing + DB-backed session tokens.
// All state lives in the users/sessions tables (no in-process secrets),
// cookies carry only an opaque token, and every data row is scoped by user_id.
//
// Compatibility mode: until the FIRST user account exists, everything runs as
// the implicit "local" user with no login required. The first signup claims
// all legacy "local" data and becomes the admin.

import crypto from "crypto";
import { cookies } from "next/headers";
import { newId, q } from "./db";

export const LEGACY_USER_ID = "local";

/** Public deployments (Vercel or REQUIRE_AUTH=1) never allow the anonymous local user. */
export const authForced = () => Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
export const SESSION_COOKIE = "liberde_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: number;
  email_verified?: number;
  created_at: number;
}

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 64).toString("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function countUsers(): Promise<number> {
  const rows = await q("SELECT COUNT(*) AS n FROM users");
  return Number(rows[0]?.n ?? 0);
}

type UserRow = User & {
  password_hash: string;
  failed_logins?: number;
  locked_until?: number;
};

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await q("SELECT * FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  return rows[0] as unknown as UserRow | undefined;
}

export async function createUser(
  email: string,
  name: string,
  password: string
): Promise<User> {
  const id = newId();
  const emailNorm = email.trim().toLowerCase();
  const nameNorm = name.trim();
  const createdAt = Date.now();
  // Decide is_admin ATOMICALLY at insert time (first account = admin) instead of
  // a separate earlier countUsers() read — closing the race where two concurrent
  // first-signups could both read 0 and both become admin.
  // The first account is admin AND auto-verified (bootstrap — the operator must
  // never be locked out behind email verification). Both decided atomically.
  await q(
    `INSERT INTO users (id, email, name, password_hash, is_admin, email_verified, created_at)
     VALUES ($1, $2, $3, $4,
        (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM users),
        (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM users), $5)`,
    [id, emailNorm, nameNorm, hashPassword(password), createdAt]
  );
  const row = (await q("SELECT is_admin FROM users WHERE id = $1", [id]))[0] as
    | { is_admin: number }
    | undefined;
  const isFirst = row?.is_admin === 1;
  if (isFirst) await claimLegacyData(id);
  return {
    id,
    email: emailNorm,
    name: nameNorm,
    is_admin: isFirst ? 1 : 0,
    email_verified: isFirst ? 1 : 0,
    created_at: createdAt,
  };
}

/** The first real account inherits everything created in single-user mode. */
async function claimLegacyData(userId: string) {
  for (const table of [
    "settings",
    "conversations",
    "projects",
    "memories",
    "skills",
    "connectors",
    "scheduled_tasks",
    "api_keys",
    "shared_chats",
  ]) {
    await q(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [
      userId,
      LEGACY_USER_ID,
    ]);
  }
}

export async function checkLogin(email: string, password: string): Promise<User | null> {
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const { password_hash: _ph, ...safe } = user;
  void _ph;
  return safe;
}

// Brute-force protection: after this many consecutive failed logins the account
// is temporarily locked. The lock AUTO-EXPIRES (so an attacker who knows a
// victim's email can't lock them out forever) and an admin can clear it
// immediately (Settings → Admin → Unlock). This is DB-backed, so unlike the
// in-memory IP rate limiter it holds across all serverless instances — it's the
// real defense against online password guessing.
export const LOGIN_MAX_FAILS = 10;
export const LOGIN_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; until: number };

/** Verify credentials with durable lockout; updates the failure counter/lock. */
export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
  const user = await getUserByEmail(email);
  if (!user) return { ok: false, reason: "invalid" };
  const now = Date.now();
  const lockedUntil = Number(user.locked_until ?? 0);
  if (lockedUntil > now) return { ok: false, reason: "locked", until: lockedUntil };

  if (verifyPassword(password, user.password_hash)) {
    if (Number(user.failed_logins ?? 0) > 0 || lockedUntil) {
      await q("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = $1", [user.id]);
    }
    const { password_hash: _ph, ...safe } = user;
    void _ph;
    return { ok: true, user: safe };
  }

  // Wrong password → increment; at the cap, lock and reset the counter so the
  // account gets a fresh set of tries once the lock expires.
  const fails = Number(user.failed_logins ?? 0) + 1;
  if (fails >= LOGIN_MAX_FAILS) {
    const until = now + LOGIN_LOCK_MS;
    await q("UPDATE users SET failed_logins = 0, locked_until = $1 WHERE id = $2", [until, user.id]);
    return { ok: false, reason: "locked", until };
  }
  await q("UPDATE users SET failed_logins = $1 WHERE id = $2", [fails, user.id]);
  return { ok: false, reason: "invalid" };
}

/** Admin action: clear a lockout + failed-attempt counter for a user. */
export async function unlockUser(userId: string): Promise<void> {
  await q("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = $1", [userId]);
}

/**
 * Admin-initiated password reset: set a fresh random temp password, sign the
 * user out everywhere, and clear any lockout. Returns the plaintext temp
 * password ONCE for the admin to relay out-of-band — it is stored only hashed
 * and cannot be retrieved again.
 */
export async function adminResetPassword(userId: string): Promise<string> {
  const temp = crypto.randomBytes(9).toString("base64url"); // 12 chars, > 8-char min
  await setUserPassword(userId, temp);
  await deleteUserSessions(userId);
  await unlockUser(userId);
  return temp;
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await q(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [sha256(token), userId, Date.now() + SESSION_TTL_MS, Date.now()]
  );
  return token;
}

export async function destroySession(token: string) {
  await q("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Email flows: password reset + email verification.

/** Email features are active only when Resend is configured. */
export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

/** "Sign in with Google" is active only when Google OAuth creds are configured. */
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * Create an account for an OAuth sign-in (Google): no usable password (a random
 * one is stored so nothing can log in by password), and email is verified since
 * the provider already authenticated it.
 */
export async function createOAuthUser(email: string, name: string): Promise<User> {
  const randomPassword = crypto.randomBytes(24).toString("base64url");
  const user = await createUser(email, name || email.split("@")[0], randomPassword);
  await setEmailVerified(user.id);
  // Mark as a Google account: no usable password, signs in only via Google — so
  // admin password-reset is blocked for it (nothing to reset).
  await q("UPDATE users SET auth_provider = 'google' WHERE id = $1", [user.id]);
  return { ...user, email_verified: 1 };
}

type TokenKind = "reset" | "verify";
const TOKEN_TTL: Record<TokenKind, number> = {
  reset: 60 * 60 * 1000, // 1 hour
  verify: 24 * 60 * 60 * 1000, // 24 hours
};

/** Mint a single-use token (stored hashed), return the raw token for the link. */
export async function createAuthToken(userId: string, kind: TokenKind): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await q(
    "INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
    [sha256(token), userId, kind, Date.now() + TOKEN_TTL[kind], Date.now()]
  );
  return token;
}

/** Validate + consume (delete) a token; returns the userId or null. */
export async function consumeAuthToken(
  token: string,
  kind: TokenKind
): Promise<string | null> {
  if (!token) return null;
  const rows = await q(
    "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > $3",
    [sha256(token), kind, Date.now()]
  );
  const userId = (rows[0] as { user_id?: string } | undefined)?.user_id;
  if (userId) await q("DELETE FROM auth_tokens WHERE token_hash = $1", [sha256(token)]);
  return userId ?? null;
}

export async function setUserPassword(userId: string, password: string) {
  await q("UPDATE users SET password_hash = $1 WHERE id = $2", [
    hashPassword(password),
    userId,
  ]);
}

/** Invalidate every session for a user (used after a password reset). */
export async function deleteUserSessions(userId: string) {
  await q("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export async function setEmailVerified(userId: string) {
  await q("UPDATE users SET email_verified = 1 WHERE id = $1", [userId]);
}

/**
 * Housekeeping: delete expired sessions and single-use tokens. Called from the
 * scheduler tick so these tables don't grow unbounded (only logout/consume
 * delete rows otherwise). Self-limiting — once it runs regularly the tables
 * stay small, so the sweep stays cheap even without an index on expires_at.
 */
export async function purgeExpiredAuth(): Promise<void> {
  const now = Date.now();
  await q("DELETE FROM sessions WHERE expires_at < $1", [now]);
  await q("DELETE FROM auth_tokens WHERE expires_at < $1", [now]);
}

export async function getUserByToken(token: string): Promise<User | undefined> {
  const rows = await q(
    `SELECT u.id, u.email, u.name, u.is_admin, u.email_verified, u.created_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [sha256(token), Date.now()]
  );
  return rows[0] as unknown as User | undefined;
}

/**
 * Resolve the acting user for a request.
 * - No accounts exist yet → the implicit "local" user (no login needed).
 * - Accounts exist → a valid session cookie is required; null means 401.
 */
export async function getRequestUserId(): Promise<string | null> {
  if (!authForced() && (await countUsers()) === 0) return LEGACY_USER_ID;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await getUserByToken(token))?.id ?? null;
}

export async function getRequestUser(): Promise<User | null> {
  if (!authForced() && (await countUsers()) === 0) {
    return {
      id: LEGACY_USER_ID,
      email: "",
      name: "Local user",
      is_admin: 1,
      email_verified: 1,
      created_at: 0,
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await getUserByToken(token)) ?? null;
}

export const unauthorized = () =>
  Response.json({ error: "Sign in required" }, { status: 401 });
