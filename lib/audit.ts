/**
 * Tamper-evident audit log.
 *
 * Enterprise procurement asks the same three things of an audit trail: that it
 * records every consequential action, that a modification to it is detectable,
 * and that it leaves the building in a format a SIEM already parses. This file
 * is all three: append, verifyAuditChain, and the JSONL/CEF exporters.
 *
 * Detection works by hash chaining: each entry's hash covers the previous
 * entry's hash plus its own fields, so editing or deleting any row breaks every
 * hash after it. That is deliberately not the same as prevention — anyone with
 * write access to the database can rewrite the chain from the edit forward.
 * What it buys is that they cannot do it quietly: the exported chain no longer
 * matches one an auditor recorded earlier. Ship the head hash somewhere you do
 * not control if you need a stronger guarantee than that.
 */

import crypto from "crypto";
import { newId, q } from "./db";

/** Actions worth a permanent record. Free-form strings would drift, so the
 *  exporters and the admin filter are built against this list. */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_reset"
  | "user.created"
  | "user.deleted"
  | "admin.signups_toggled"
  | "admin.user_unlocked"
  | "admin.password_reset"
  | "apikey.created"
  | "apikey.revoked"
  | "provider.updated"
  | "connector.created"
  | "connector.deleted"
  | "tool.called"
  | "skill.imported"
  | "skill.deleted"
  | "artifact.published"
  | "artifact.shared"
  | "conversation.shared"
  | "conversation.deleted"
  | "workspace.created"
  | "workspace.updated"
  | "workspace.deleted"
  | "workspace.member_added"
  | "workspace.member_role_changed"
  | "workspace.member_removed"
  | "agent.run_started"
  | "agent.run_finished";

export interface AuditEntry {
  id: string;
  seq: number;
  at: number;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  prev_hash: string;
  hash: string;
}

export interface AuditInput {
  action: AuditAction;
  /** Who did it. Null for scheduler or system activity. */
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Anything else worth keeping. Never secrets, never message bodies. */
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * The exact bytes an entry's hash covers.
 *
 * Each field is prefixed with its UTF-8 byte length rather than joined by a
 * separator. A separator would be forgeable: tool names and JSON details can
 * both contain the delimiter, so target_type="tool" with target_id="a|b"
 * and target_type="tool|a" with target_id="b" would hash identically, which
 * is precisely the substitution a tamper-evident log has to rule out.
 *
 * Byte length, not String.length: Postgres counts characters and JavaScript
 * counts UTF-16 units, and the two disagree the moment an emoji appears in a
 * tool name. Field order and this encoding are part of the format — change
 * either and every chain written beforehand fails verification, so this must
 * stay in lockstep with the audit_append SQL function.
 */
export function auditPayload(e: {
  id: string;
  at: number;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
}): string {
  const field = (v: string) => Buffer.byteLength(v, "utf8") + ":" + v;
  return [
    e.id,
    String(e.at),
    e.user_id ?? "",
    e.action,
    e.target_type ?? "",
    e.target_id ?? "",
    e.detail ?? "",
    e.ip ?? "",
  ]
    .map(field)
    .join("");
}
const hashEntry = (prev: string, payload: string) =>
  crypto.createHash("sha256").update(prev + "|" + payload, "utf8").digest("hex");

/**
 * Append one entry. Never throws: an audit trail that can take a request down
 * with it becomes the first thing an operator switches off, and one dropped
 * entry is a smaller problem than a failed login. Failures log loudly instead.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const detail = input.detail ? JSON.stringify(input.detail) : null;
    await q("SELECT audit_append($1, $2, $3, $4, $5, $6, $7, $8)", [
      newId(),
      Date.now(),
      input.userId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      detail,
      input.ip ?? null,
    ]);
  } catch (e) {
    console.error("[liberde] audit append failed:", String(e).slice(0, 300));
  }
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

const MAX_PAGE = 1000;

export async function listAudit(filter: AuditQuery = {}): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    where.push(column + " $" + params.length);
  };
  if (filter.userId) add("user_id =", filter.userId);
  if (filter.action) add("action =", filter.action);
  if (filter.since) add("at >=", filter.since);
  if (filter.until) add("at <=", filter.until);

  const limit = Math.min(Math.max(1, filter.limit ?? 200), MAX_PAGE);
  params.push(limit, Math.max(0, filter.offset ?? 0));
  const rows = await q(
    "SELECT * FROM audit_log " +
      (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
      "ORDER BY seq ASC LIMIT $" + (params.length - 1) + " OFFSET $" + params.length,
    params
  );
  return rows as unknown as AuditEntry[];
}

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  /** Sequence number of the first entry whose hash does not recompute. */
  brokenAt?: number;
  reason?: string;
  /** Head hash. Record this externally to detect a wholesale rewrite. */
  head?: string;
}

/**
 * Recompute the whole chain and report the first entry that does not match.
 * Paged so a long-retained log never has to fit in memory at once.
 */
export async function verifyAuditChain(): Promise<ChainVerdict> {
  let prev = "";
  let checked = 0;
  let offset = 0;
  let head: string | undefined;

  for (;;) {
    const page = (await q(
      "SELECT * FROM audit_log ORDER BY seq ASC LIMIT $1 OFFSET $2",
      [MAX_PAGE, offset]
    )) as unknown as AuditEntry[];
    if (page.length === 0) break;

    for (const row of page) {
      if (row.prev_hash !== prev) {
        return {
          ok: false,
          checked,
          brokenAt: row.seq,
          reason:
            "Entry does not link to the one before it — a row was removed or reordered.",
        };
      }
      if (hashEntry(prev, auditPayload(row)) !== row.hash) {
        return {
          ok: false,
          checked,
          brokenAt: row.seq,
          reason: "Entry hash does not match its contents — the row was modified.",
        };
      }
      prev = row.hash;
      head = row.hash;
      checked++;
    }
    offset += page.length;
    if (page.length < MAX_PAGE) break;
  }
  return { ok: true, checked, head };
}

/** Newline-delimited JSON: one entry per line, the usual SIEM ingest shape. */
export function toJsonl(entries: AuditEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}

/** CEF escaping: backslash and pipe in the header, backslash and equals in
 *  extension values. Newlines would split one event into two, so they go too. */
const cefHeader = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const cefValue = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/\r?\n/g, " ");

/** Actions that should stand out in a SIEM's severity column. */
const HIGH_SEVERITY = new Set([
  "auth.login_failed",
  "admin.password_reset",
  "user.deleted",
]);

/** Common Event Format, which most SIEMs parse without a custom connector. */
export function toCef(entries: AuditEntry[]): string {
  return entries
    .map((e) => {
      const ext: string[] = [
        "rt=" + e.at,
        "externalId=" + cefValue(e.id),
        "cs1Label=seq cs1=" + e.seq,
      ];
      if (e.user_id) ext.push("suser=" + cefValue(e.user_id));
      if (e.ip) ext.push("src=" + cefValue(e.ip));
      if (e.target_type) ext.push("cs2Label=targetType cs2=" + cefValue(e.target_type));
      if (e.target_id) ext.push("cs3Label=targetId cs3=" + cefValue(e.target_id));
      if (e.detail) ext.push("cs4Label=detail cs4=" + cefValue(e.detail.slice(0, 1000)));
      ext.push("cs5Label=hash cs5=" + cefValue(e.hash));
      const severity = HIGH_SEVERITY.has(e.action) ? 7 : 3;
      const name = cefHeader(e.action);
      return "CEF:0|Liberde|Liberde|1.0|" + name + "|" + name + "|" + severity + "|" + ext.join(" ");
    })
    .join("\n");
}

/**
 * Drop entries older than the retention window and report how many went.
 * Regulated retention runs five to seven years, so the default keeps
 * everything until an operator sets audit_retention_days deliberately —
 * silently discarding an audit trail is worse than keeping too much of one.
 */
export async function purgeAudit(retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const rows = await q("DELETE FROM audit_log WHERE at < $1 RETURNING seq", [cutoff]);
  return rows.length;
}
