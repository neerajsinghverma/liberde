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

export async function getUserByEmail(
  email: string
): Promise<(User & { password_hash: string }) | undefined> {
  const rows = await q("SELECT * FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  return rows[0] as unknown as (User & { password_hash: string }) | undefined;
}

export async function createUser(
  email: string,
  name: string,
  password: string
): Promise<User> {
  const isFirst = (await countUsers()) === 0;
  const user: User & { password_hash: string } = {
    id: newId(),
    email: email.trim().toLowerCase(),
    name: name.trim(),
    password_hash: hashPassword(password),
    is_admin: isFirst ? 1 : 0,
    created_at: Date.now(),
  };
  await q(
    "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [user.id, user.email, user.name, user.password_hash, user.is_admin, user.created_at]
  );
  if (isFirst) await claimLegacyData(user.id);
  const { password_hash: _ph, ...safe } = user;
  void _ph;
  return safe;
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

export async function getUserByToken(token: string): Promise<User | undefined> {
  const rows = await q(
    `SELECT u.id, u.email, u.name, u.is_admin, u.created_at FROM sessions s
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
      created_at: 0,
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await getUserByToken(token)) ?? null;
}

export const unauthorized = () =>
  Response.json({ error: "Sign in required" }, { status: 401 });
