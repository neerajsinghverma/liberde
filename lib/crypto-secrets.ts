// AES-256-GCM encryption for secrets stored at rest (OpenRouter/provider API
// keys, custom-tool secrets, MCP connector tokens). The master key lives ONLY
// in the environment (LIBERDE_SECRET_KEY), never in the database — so a
// database-only compromise (leaked backup, stolen DB credentials, read replica,
// SQL-injection read) yields ciphertext an attacker cannot read without also
// stealing the app's environment.
//
// Stored values are tagged "enc:v1:" so decrypt() can transparently pass through
// legacy plaintext rows (written before a key was configured, or on a self-host
// that never sets one). That makes rollout and migration non-breaking: mixed
// plaintext/ciphertext rows both read correctly.

import crypto from "crypto";

const PREFIX = "enc:v1:";

/** Resolve the 32-byte master key from the environment, or null if unset. */
function masterKey(): Buffer | null {
  const raw = process.env.LIBERDE_SECRET_KEY;
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  // A 64-char hex string or a 32-byte base64 string is used directly; any other
  // sufficiently-long passphrase is stretched to 32 bytes via SHA-256.
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex");
  try {
    const b64 = Buffer.from(t, "base64");
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  return crypto.createHash("sha256").update(t).digest();
}

/** Whether at-rest secret encryption is active (a master key is configured). */
export function secretsKeyConfigured(): boolean {
  return masterKey() !== null;
}

/** True if a stored value is in encrypted form. */
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/**
 * Encrypt a secret for storage. Idempotent (won't double-encrypt), and a no-op
 * passthrough when no key is configured (self-host default) or the value is
 * empty — callers can wrap every write unconditionally.
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const key = masterKey();
  if (!key) return plain; // no key → store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a stored secret. Legacy plaintext (no prefix) passes through
 * unchanged, so this is safe to apply to every read.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = masterKey();
  if (!key) {
    throw new Error(
      "LIBERDE_SECRET_KEY is not set, but an encrypted secret was read from the database"
    );
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
