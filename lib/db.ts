import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import crypto from "crypto";
import type {
  AgentRun,
  AgentStep,
  Attachment,
  Conversation,
  DesignSystem,
  HttpTool,
  HttpToolAuth,
  HttpToolParam,
  Message,
  Project,
  ProjectFile,
} from "./types";

// Neon over HTTP: works on Vercel serverless and locally alike.
// fullResults gives us field type OIDs so we can coerce BIGINT/NUMERIC
// (returned as strings by the driver) back to JS numbers, matching the
// shapes the SQLite version returned.
// Lazy + sanitized: builds must not require the env var at import time, and
// env values sometimes arrive with a BOM or stray whitespace.
let _sql: NeonQueryFunction<false, true> | null = null;
function sqlClient(): NeonQueryFunction<false, true> {
  if (!_sql) {
    const url = (process.env.DATABASE_URL ?? "")
      .replace(/^﻿/, "")
      .trim();
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url, { fullResults: true });
  }
  return _sql;
}

const INT8_OID = 20;
const NUMERIC_OID = 1700;

async function rawQuery(
  text: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const res = await sqlClient().query(text, params);
  const numericFields = res.fields
    .filter((f) => f.dataTypeID === INT8_OID || f.dataTypeID === NUMERIC_OID)
    .map((f) => f.name);
  if (numericFields.length > 0) {
    for (const row of res.rows as Record<string, unknown>[]) {
      for (const name of numericFields) {
        if (row[name] != null) row[name] = Number(row[name]);
      }
    }
  }
  return res.rows as Record<string, unknown>[];
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT NOT NULL DEFAULT 'local',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New chat',
    model TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    is_temp INTEGER NOT NULL DEFAULT 0,
    starred INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    attachments TEXT,
    reasoning TEXT,
    annotations TEXT,
    images TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    reasoning_ms INTEGER,
    cost DOUBLE PRECISION,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    type TEXT NOT NULL,
    language TEXT,
    title TEXT NOT NULL,
    share_id TEXT UNIQUE,
    share_mode TEXT,
    pinned_version INTEGER,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE(conversation_id, identifier)
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    message_id TEXT,
    created_at BIGINT NOT NULL,
    UNIQUE(artifact_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL,
    last_used_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS shared_chats (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    body TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_at BIGINT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL,
    command TEXT,
    args TEXT,
    url TEXT,
    headers TEXT,
    oauth_data TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    interval_minutes INTEGER,
    daily_time TEXT,
    web_search INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run BIGINT NOT NULL,
    last_run BIGINT,
    last_conversation_id TEXT,
    last_error TEXT,
    user_id TEXT NOT NULL DEFAULT 'local',
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    anchor_id TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    preview TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
  )`,
  // Additive migrations for databases created by earlier versions.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE skills ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE shared_chats ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS annotations TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS images TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_call_id TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning_ms INTEGER`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_in INTEGER`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_out INTEGER`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_temp INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS starred INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS oauth_data TEXT`,
  `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS tools_cache TEXT`,
  `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS last_tested BIGINT`,
  `ALTER TABLE skills ADD COLUMN IF NOT EXISTS connector_ids TEXT`,
  `ALTER TABLE skills ADD COLUMN IF NOT EXISTS http_tool_ids TEXT`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS locked_at BIGINT`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL DEFAULT 'local',
    goal TEXT NOT NULL,
    model TEXT NOT NULL,
    planner_model TEXT NOT NULL DEFAULT '',
    exec_model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    steps TEXT NOT NULL DEFAULT '[]',
    current_step INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '[]',
    run_msg_id TEXT,
    total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    context_block TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  // Defensive: if an agent_runs table already exists in an older/partial shape,
  // bring it up to spec before the index below references these columns.
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS steps TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS current_step INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS total_cost DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS context_block TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS planner_model TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS exec_model TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS run_msg_id TEXT`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error TEXT`,
  // Base columns an old/partial agent_runs table may predate. conversation_id
  // is nullable here (the CREATE above adds NOT NULL + FK for fresh tables; the
  // INSERT always supplies it) so this ALTER can't fail on existing rows.
  // A very old agent_runs had a NOT-NULL "payload" jsonb column the current
  // code never sets — drop it so inserts don't violate the constraint.
  `ALTER TABLE agent_runs DROP COLUMN IF EXISTS payload`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS conversation_id TEXT`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS goal TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, updated_at)`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chat'`,
  `CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    mime TEXT NOT NULL DEFAULT 'image/png',
    data TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    subscription TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  // Per-user list queries run on nearly every page load / API call. Without
  // these, Postgres sequential-scans these tables as data grows.
  `CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shared_chats_user ON shared_chats(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_branches_conversation ON branches(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  // The scheduler polls due tasks every minute.
  `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks(enabled, next_run)`,
  // Design systems: named, reusable brand specs applied to Design-mode builds.
  `CREATE TABLE IF NOT EXISTS design_systems (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    name TEXT NOT NULL,
    spec TEXT NOT NULL,
    palette TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  // User-to-user shares (same shape as project_members).
  `CREATE TABLE IF NOT EXISTS design_system_shares (
    design_system_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_at BIGINT NOT NULL,
    PRIMARY KEY (design_system_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_shares (
    artifact_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_at BIGINT NOT NULL,
    PRIMARY KEY (artifact_id, user_id)
  )`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS design_system_id TEXT`,
  // Cost attribution: JSON {"model":n,"search":n,"image":n} per assistant turn.
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS cost_breakdown TEXT`,
  // Wall-clock generation time per assistant turn (footer: cost · tok · ms).
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  // Auto routing: the reason the router picked this turn's model (footer badge).
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS route_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_design_systems_user ON design_systems(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_design_system_shares_user ON design_system_shares(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_shares_user ON artifact_shares(user_id)`,
  // Email flows: short-lived password-reset / email-verify tokens (hashed), and
  // a per-user verified flag.
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 0`,
  // Brute-force lockout: consecutive failed logins + a temporary lock timestamp.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until BIGINT NOT NULL DEFAULT 0`,
  // How the account signs in: 'password' or 'google' (OAuth accounts have no
  // usable password, so admin password-reset must not apply to them).
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'`,
  `CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)`,
  // Both queried WHERE user_id (push-send on every completion; task list) but
  // their PKs are endpoint/id — without these they sequential-scan at scale.
  `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id)`,
  // User-defined REST endpoints exposed to the model as callable tools.
  `CREATE TABLE IF NOT EXISTS http_tools (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'GET',
    url_template TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '[]',
    headers TEXT NOT NULL DEFAULT '{}',
    auth TEXT NOT NULL DEFAULT '{"type":"none"}',
    auth_secret TEXT,
    body_mode TEXT NOT NULL DEFAULT 'auto',
    body_template TEXT,
    response_extract TEXT,
    max_response_bytes INTEGER NOT NULL DEFAULT 24576,
    auto_run INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    openapi_group TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_http_tools_user ON http_tools(user_id)`,
];

async function initSchema(): Promise<void> {
  // Each DDL statement is idempotent (IF NOT EXISTS), so a single failure must
  // never abort the whole migration and poison every subsequent query — which
  // would take the entire app down. Log and continue.
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await sqlClient().query(stmt);
    } catch (e) {
      console.error("[liberde] schema statement failed (continuing):", String(e).slice(0, 200));
    }
  }

  // One-time grandfather: accounts that existed BEFORE email verification was
  // introduced must not be locked out by the new login gate. Runs exactly once
  // (guarded by a marker), so genuinely-unverified future signups stay gated.
  try {
    const done = (await sqlClient().query(
      "SELECT 1 FROM settings WHERE user_id = 'global' AND key = 'email_verify_backfill' LIMIT 1"
    )).rows;
    if (done.length === 0) {
      await sqlClient().query("UPDATE users SET email_verified = 1");
      await sqlClient().query(
        "INSERT INTO settings (user_id, key, value) VALUES ('global', 'email_verify_backfill', '1') ON CONFLICT(user_id, key) DO NOTHING"
      );
    }
  } catch (e) {
    console.error("[liberde] email-verify backfill failed (continuing):", String(e).slice(0, 200));
  }

  // Temporary chats are ephemeral by contract: purge stale ones on boot.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const staleTmp = (await sqlClient().query(
    "SELECT id FROM conversations WHERE is_temp = 1 AND updated_at < $1",
    [dayAgo]
  )).rows as { id: string }[];
  for (const { id } of staleTmp) {
    await sqlClient().query(
      "DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = $1)",
      [id]
    );
    await sqlClient().query("DELETE FROM artifacts WHERE conversation_id = $1", [id]);
    await sqlClient().query("DELETE FROM messages WHERE conversation_id = $1", [id]);
    await sqlClient().query("DELETE FROM conversations WHERE id = $1", [id]);
  }
}

// Memoized once per process; survives Next.js dev-server hot reloads.
const globalForDb = globalThis as unknown as {
  __liberdeSchemaReady?: Promise<void>;
};

function ensureSchema(): Promise<void> {
  if (!globalForDb.__liberdeSchemaReady) {
    globalForDb.__liberdeSchemaReady = initSchema().catch((e) => {
      // Allow a retry on the next query rather than caching the failure forever.
      globalForDb.__liberdeSchemaReady = undefined;
      throw e;
    });
  }
  return globalForDb.__liberdeSchemaReady;
}

/** Run a parameterized query ($1, $2, …) after the schema is ready. */
export async function q(
  text: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  await ensureSchema();
  return rawQuery(text, params);
}

export const newId = () => crypto.randomUUID();
const now = () => Date.now();

// ---------- per-conversation generation lock ----------
// One in-flight generation per conversation: overlapping streams would
// interleave assistant/tool messages and corrupt the replayable history.
// Backed by a `conversations.locked_at` timestamp so it coordinates across
// serverless instances and self-heals: a lock older than the TTL (a crashed or
// timed-out run) is considered stale and can be re-acquired. The TTL exceeds
// maxDuration (300s), so a still-running holder is never stolen from.
const LOCK_TTL_MS = 6 * 60 * 1000;

export async function tryLockConversation(id: string): Promise<boolean> {
  const now = Date.now();
  const stale = now - LOCK_TTL_MS;
  const rows = await q(
    `UPDATE conversations SET locked_at = $1
     WHERE id = $2 AND (locked_at IS NULL OR locked_at < $3)
     RETURNING id`,
    [now, id, stale]
  );
  return rows.length > 0;
}

export async function unlockConversation(id: string) {
  await q("UPDATE conversations SET locked_at = NULL WHERE id = $1", [id]);
}

// ---------- settings ----------

export const DEFAULT_USER = "local";

export async function getSetting(
  key: string,
  userId: string = DEFAULT_USER
): Promise<string | null> {
  const rows = await q(
    "SELECT value FROM settings WHERE user_id = $1 AND key = $2",
    [userId, key]
  );
  return (rows[0]?.value as string | undefined) ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  userId: string = DEFAULT_USER
) {
  await q(
    "INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    [userId, key, value]
  );
}

export async function getApiKey(userId: string = DEFAULT_USER): Promise<string> {
  const own = await getSetting("openrouter_api_key", userId);
  if (own) return own;
  // The shared OPENROUTER_API_KEY env fallback is allowed ONLY for a
  // single-user/local install (no auth). Any multi-user or public deploy
  // (Vercel, or REQUIRE_AUTH set) is strictly per-user — never let one user
  // (or the operator's key) be spent by anyone else.
  const multiUser = Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
  return multiUser ? "" : process.env.OPENROUTER_API_KEY || "";
}

// ---------- conversations ----------

export async function listConversations(
  userId: string = DEFAULT_USER,
  mode: string = "chat"
): Promise<Conversation[]> {
  return (await q(
    "SELECT * FROM conversations WHERE user_id = $1 AND is_temp = 0 AND archived = 0 AND mode = $2 ORDER BY updated_at DESC",
    [userId, mode]
  )) as unknown as Conversation[];
}

export async function listArchivedConversations(
  userId: string = DEFAULT_USER
): Promise<Conversation[]> {
  return (await q(
    "SELECT * FROM conversations WHERE user_id = $1 AND is_temp = 0 AND archived = 1 ORDER BY updated_at DESC",
    [userId]
  )) as unknown as Conversation[];
}

/** Unified search: conversations, projects (incl. knowledge files), artifacts. */
export interface UsageStats {
  total: { cost: number; tokensIn: number; tokensOut: number; messages: number };
  byModel: { model: string; n: number; cost: number; tin: number; tout: number }[];
  byDay: { day: number; cost: number; n: number }[];
  /** Spend by category: model | search | image (from per-message breakdowns). */
  byCategory: Record<string, number>;
}

/** Aggregate this user's assistant-message spend for the usage dashboard. */
export async function usageStats(userId: string = DEFAULT_USER): Promise<UsageStats> {
  const byModel = (await q(
    `SELECT m.model, COUNT(*)::int AS n, COALESCE(SUM(m.cost),0) AS cost,
            COALESCE(SUM(m.tokens_in),0)::bigint AS tin, COALESCE(SUM(m.tokens_out),0)::bigint AS tout
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.role = 'assistant'
     GROUP BY m.model ORDER BY cost DESC`,
    [userId]
  )) as unknown as { model: string; n: number; cost: number; tin: number; tout: number }[];
  const since = Date.now() - 30 * 86_400_000;
  const byDay = (await q(
    `SELECT (m.created_at / 86400000)::bigint AS day, COALESCE(SUM(m.cost),0) AS cost, COUNT(*)::int AS n
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.role = 'assistant' AND m.created_at > $2
     GROUP BY day ORDER BY day`,
    [userId, since]
  )) as unknown as { day: number; cost: number; n: number }[];
  const total = byModel.reduce(
    (a, r) => ({
      cost: a.cost + (r.cost || 0),
      tokensIn: a.tokensIn + (r.tin || 0),
      tokensOut: a.tokensOut + (r.tout || 0),
      messages: a.messages + (r.n || 0),
    }),
    { cost: 0, tokensIn: 0, tokensOut: 0, messages: 0 }
  );
  // Where the money goes: sum per-message cost_breakdown JSON. Messages from
  // before attribution existed (no breakdown) count as plain model spend.
  const bdRows = (await q(
    `SELECT m.cost, m.cost_breakdown FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.role = 'assistant' AND m.cost > 0`,
    [userId]
  )) as unknown as { cost: number; cost_breakdown: string | null }[];
  const byCategory: Record<string, number> = {};
  for (const r of bdRows) {
    let bd: Record<string, number> | null = null;
    try {
      bd = r.cost_breakdown ? JSON.parse(r.cost_breakdown) : null;
    } catch {
      bd = null;
    }
    if (bd && typeof bd === "object") {
      for (const [k, v] of Object.entries(bd)) {
        if (typeof v === "number" && v > 0) byCategory[k] = (byCategory[k] ?? 0) + v;
      }
    } else {
      byCategory.model = (byCategory.model ?? 0) + (r.cost || 0);
    }
  }
  return {
    total,
    byModel: byModel.map((r) => ({ ...r, model: r.model || "unknown" })),
    byDay,
    byCategory,
  };
}

export interface PromptRecord {
  id: string;
  name: string;
  slug: string;
  body: string;
  user_id: string;
  created_at: number;
}

export async function listPrompts(userId: string = DEFAULT_USER): Promise<PromptRecord[]> {
  return (await q(
    "SELECT * FROM prompts WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  )) as unknown as PromptRecord[];
}

export async function createPrompt(
  input: { name: string; body: string },
  userId: string = DEFAULT_USER
): Promise<PromptRecord> {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "prompt";
  const rec = { id: newId(), name: input.name, slug, body: input.body, user_id: userId, created_at: now() };
  await q(
    "INSERT INTO prompts (id, name, slug, body, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [rec.id, rec.name, rec.slug, rec.body, rec.user_id, rec.created_at]
  );
  return rec as PromptRecord;
}

export async function deletePrompt(id: string, userId: string = DEFAULT_USER) {
  await q("DELETE FROM prompts WHERE id = $1 AND user_id = $2", [id, userId]);
}

/** Month-to-date assistant spend for this user, for budget enforcement. */
export async function spendThisMonth(userId: string = DEFAULT_USER): Promise<number> {
  const d = new Date();
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const rows = (await q(
    `SELECT COALESCE(SUM(m.cost),0) AS cost FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.role = 'assistant' AND m.created_at >= $2`,
    [userId, monthStart]
  )) as unknown as { cost: number }[];
  return Number(rows[0]?.cost) || 0;
}

export async function searchAll(
  query: string,
  userId: string = DEFAULT_USER
): Promise<{
  conversations: Conversation[];
  projects: Project[];
  artifacts: { id: string; conversation_id: string; identifier: string; title: string; type: string }[];
}> {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const projects = (await q(
    `SELECT DISTINCT p.* FROM projects p
     LEFT JOIN project_files f ON f.project_id = p.id
     WHERE p.user_id = $1 AND (p.name ILIKE $2 ESCAPE '\\' OR p.instructions ILIKE $3 ESCAPE '\\'
       OR f.name ILIKE $4 ESCAPE '\\' OR f.content ILIKE $5 ESCAPE '\\')
     ORDER BY p.created_at DESC LIMIT 10`,
    [userId, like, like, like, like]
  )) as unknown as Project[];
  const artifacts = (await q(
    `SELECT DISTINCT a.id, a.conversation_id, a.identifier, a.title, a.type, a.updated_at
     FROM artifacts a
     JOIN conversations c ON c.id = a.conversation_id
     LEFT JOIN artifact_versions v ON v.artifact_id = a.id
     WHERE c.user_id = $1 AND (a.title ILIKE $2 ESCAPE '\\' OR a.identifier ILIKE $3 ESCAPE '\\'
       OR v.content ILIKE $4 ESCAPE '\\')
     ORDER BY a.updated_at DESC LIMIT 10`,
    [userId, like, like, like]
  )) as unknown as {
    id: string;
    conversation_id: string;
    identifier: string;
    title: string;
    type: string;
  }[];
  return {
    conversations: await searchConversations(query, userId),
    projects,
    artifacts,
  };
}

/** Full-text search across conversation titles and message content. */
export interface RecallHit {
  conversation_id: string;
  title: string;
  role: string;
  content: string;
  created_at: number;
}

/** Recall: find message excerpts across the user's past (non-temp) chats that
 *  match a query — used by the model-callable "search_past_chats" tool. */
export async function searchPastMessages(
  query: string,
  userId: string = DEFAULT_USER,
  limit = 8
): Promise<RecallHit[]> {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return (await q(
    `SELECT c.id AS conversation_id, c.title AS title, m.role AS role,
            m.content AS content, m.created_at AS created_at
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND c.is_temp = 0 AND m.role IN ('user','assistant')
       AND m.content ILIKE $2 ESCAPE '\\'
     ORDER BY m.created_at DESC LIMIT $3`,
    [userId, like, limit]
  )) as unknown as RecallHit[];
}

export async function searchConversations(
  query: string,
  userId: string = DEFAULT_USER
): Promise<Conversation[]> {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return (await q(
    `SELECT DISTINCT c.* FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.user_id = $1 AND c.is_temp = 0 AND (c.title ILIKE $2 ESCAPE '\\' OR m.content ILIKE $3 ESCAPE '\\')
     ORDER BY c.updated_at DESC LIMIT 50`,
    [userId, like, like]
  )) as unknown as Conversation[];
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const rows = await q("SELECT * FROM conversations WHERE id = $1", [id]);
  return rows[0] as unknown as Conversation | undefined;
}

export async function createConversation(
  model: string,
  projectId: string | null = null,
  isTemp = false,
  userId: string = DEFAULT_USER,
  mode: string = "chat"
): Promise<Conversation> {
  const conv: Conversation = {
    id: newId(),
    title: isTemp ? "Temporary chat" : "New chat",
    model,
    project_id: projectId,
    is_temp: isTemp ? 1 : 0,
    user_id: userId,
    mode,
    created_at: now(),
    updated_at: now(),
  };
  await q(
    "INSERT INTO conversations (id, title, model, project_id, is_temp, user_id, mode, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      conv.id,
      conv.title,
      conv.model,
      conv.project_id,
      conv.is_temp,
      conv.user_id,
      conv.mode,
      conv.created_at,
      conv.updated_at,
    ]
  );
  return conv;
}

export async function updateConversation(
  id: string,
  fields: Partial<
    Pick<
      Conversation,
      "title" | "model" | "project_id" | "starred" | "archived" | "design_system_id"
    >
  >
) {
  const conv = await getConversation(id);
  if (!conv) return;
  const merged = {
    starred: 0,
    archived: 0,
    design_system_id: null as string | null,
    ...conv,
    ...fields,
    updated_at: now(),
  };
  await q(
    "UPDATE conversations SET title = $1, model = $2, project_id = $3, starred = $4, archived = $5, design_system_id = $6, updated_at = $7 WHERE id = $8",
    [
      merged.title,
      merged.model,
      merged.project_id,
      merged.starred,
      merged.archived,
      merged.design_system_id,
      merged.updated_at,
      id,
    ]
  );
}

export async function touchConversation(id: string) {
  await q("UPDATE conversations SET updated_at = $1 WHERE id = $2", [now(), id]);
}

export async function deleteConversation(id: string) {
  await deleteArtifactsForConversation(id);
  await deleteSharedChatsFor(id);
  await deleteBranchesFor(id);
  await q("DELETE FROM messages WHERE conversation_id = $1", [id]);
  await q("DELETE FROM conversations WHERE id = $1", [id]);
}

// ---------- messages ----------

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    ...(row as unknown as Message),
    attachments: row.attachments ? JSON.parse(row.attachments as string) : null,
    annotations: row.annotations ? JSON.parse(row.annotations as string) : null,
    images: row.images ? JSON.parse(row.images as string) : null,
    tool_calls: row.tool_calls ? JSON.parse(row.tool_calls as string) : null,
  };
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const rows = await q(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, seq ASC",
    [conversationId]
  );
  return rows.map(rowToMessage);
}

/** Concrete model of the most recent assistant turn — used for Auto stickiness. */
export async function getLastAssistantModel(conversationId: string): Promise<string | null> {
  const rows = await q(
    "SELECT model FROM messages WHERE conversation_id = $1 AND role = 'assistant' AND model IS NOT NULL AND model <> 'auto' ORDER BY created_at DESC, seq DESC LIMIT 1",
    [conversationId]
  );
  return (rows[0]?.model as string | undefined) ?? null;
}

export async function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  model: string | null = null,
  attachments: Attachment[] | null = null,
  extras: {
    reasoning?: string | null;
    annotations?: unknown[] | null;
    images?: string[] | null;
    tool_calls?: unknown[] | null;
    tool_call_id?: string | null;
    reasoning_ms?: number | null;
    cost?: number | null;
    tokens_in?: number | null;
    tokens_out?: number | null;
    cost_breakdown?: string | null;
    duration_ms?: number | null;
    route_reason?: string | null;
  } = {}
): Promise<Message> {
  const msg: Message = {
    id: newId(),
    conversation_id: conversationId,
    role,
    content,
    model,
    attachments,
    reasoning: extras.reasoning ?? null,
    annotations: (extras.annotations as Message["annotations"]) ?? null,
    images: extras.images ?? null,
    tool_calls: extras.tool_calls ?? null,
    tool_call_id: extras.tool_call_id ?? null,
    reasoning_ms: extras.reasoning_ms ?? null,
    cost: extras.cost ?? null,
    tokens_in: extras.tokens_in ?? null,
    tokens_out: extras.tokens_out ?? null,
    cost_breakdown: extras.cost_breakdown ?? null,
    duration_ms: extras.duration_ms ?? null,
    route_reason: extras.route_reason ?? null,
    created_at: now(),
  };
  await q(
    "INSERT INTO messages (id, conversation_id, role, content, model, attachments, reasoning, annotations, images, tool_calls, tool_call_id, reasoning_ms, cost, tokens_in, tokens_out, cost_breakdown, duration_ms, route_reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
    [
      msg.id,
      msg.conversation_id,
      msg.role,
      msg.content,
      msg.model,
      attachments ? JSON.stringify(attachments) : null,
      msg.reasoning,
      msg.annotations ? JSON.stringify(msg.annotations) : null,
      msg.images ? JSON.stringify(msg.images) : null,
      msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id,
      msg.reasoning_ms,
      msg.cost,
      msg.tokens_in,
      msg.tokens_out,
      msg.cost_breakdown,
      msg.duration_ms,
      msg.route_reason,
      msg.created_at,
    ]
  );
  await touchConversation(conversationId);
  return msg;
}

export async function updateMessageContent(id: string, content: string) {
  await q("UPDATE messages SET content = $1 WHERE id = $2", [content, id]);
}

/** Persist a generated image (base64) and return its id; served by /img/[id]. */
export async function saveGeneratedImage(
  userId: string,
  mime: string,
  base64: string
): Promise<string> {
  const id = newId();
  await q(
    "INSERT INTO generated_images (id, user_id, mime, data, created_at) VALUES ($1,$2,$3,$4,$5)",
    [id, userId, mime, base64, now()]
  );
  return id;
}

export async function getGeneratedImage(
  id: string
): Promise<{ mime: string; data: string } | undefined> {
  const rows = await q("SELECT mime, data FROM generated_images WHERE id = $1", [id]);
  return rows[0] as unknown as { mime: string; data: string } | undefined;
}

/** Record the accumulated cost of a run on its checkpoint message so it counts
 *  toward monthly-budget accounting (spendThisMonth sums messages.cost). */
export async function updateMessageCost(id: string, cost: number) {
  await q("UPDATE messages SET cost = $1 WHERE id = $2", [cost || null, id]);
}

// ---------- durable agent runs ----------

function rowToAgentRun(r: Record<string, unknown>): AgentRun {
  return {
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    user_id: r.user_id as string,
    goal: r.goal as string,
    model: r.model as string,
    planner_model: (r.planner_model as string) ?? "",
    exec_model: (r.exec_model as string) ?? "",
    status: r.status as AgentRun["status"],
    steps: JSON.parse((r.steps as string) || "[]"),
    current_step: Number(r.current_step) || 0,
    notes: JSON.parse((r.notes as string) || "[]"),
    run_msg_id: (r.run_msg_id as string) ?? null,
    total_cost: Number(r.total_cost) || 0,
    context_block: (r.context_block as string) ?? "",
    error: (r.error as string) ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

export async function createAgentRun(fields: {
  conversationId: string;
  userId: string;
  goal: string;
  model: string;
  plannerModel: string;
  execModel: string;
  contextBlock: string;
}): Promise<AgentRun> {
  const id = newId();
  const ts = now();
  await q(
    // created_at ($9) and updated_at ($10) are passed as SEPARATE params — the
    // Neon driver can't deduce a consistent type when one placeholder is reused
    // across two columns ("inconsistent types deduced for parameter $9").
    `INSERT INTO agent_runs (id, conversation_id, user_id, goal, model, planner_model, exec_model, status, steps, current_step, notes, total_cost, context_block, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'running','[]',0,'[]',0,$8,$9,$10)`,
    [
      id,
      fields.conversationId,
      fields.userId,
      fields.goal,
      fields.model,
      fields.plannerModel,
      fields.execModel,
      fields.contextBlock,
      ts,
      ts,
    ]
  );
  const rows = await q("SELECT * FROM agent_runs WHERE id = $1", [id]);
  return rowToAgentRun(rows[0]);
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const rows = await q("SELECT * FROM agent_runs WHERE id = $1", [id]);
  return rows[0] ? rowToAgentRun(rows[0]) : null;
}

export async function updateAgentRun(
  id: string,
  patch: Partial<{
    status: AgentRun["status"];
    steps: AgentStep[];
    current_step: number;
    notes: string[];
    run_msg_id: string | null;
    total_cost: number;
    error: string | null;
  }>
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const add = (col: string, val: unknown) => {
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.steps !== undefined) add("steps", JSON.stringify(patch.steps));
  if (patch.current_step !== undefined) add("current_step", patch.current_step);
  if (patch.notes !== undefined) add("notes", JSON.stringify(patch.notes));
  if (patch.run_msg_id !== undefined) add("run_msg_id", patch.run_msg_id);
  if (patch.total_cost !== undefined) add("total_cost", patch.total_cost);
  if (patch.error !== undefined) add("error", patch.error);
  add("updated_at", now());
  vals.push(id);
  await q(`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

/** Runs still 'running' but untouched for `staleMs` — a streamer likely died.
 *  Used by the server-side backstop to resume orphaned runs. */
export async function listResumableAgentRuns(staleMs: number): Promise<AgentRun[]> {
  const rows = await q(
    `SELECT * FROM agent_runs WHERE status IN ('running','synthesizing') AND updated_at < $1
     ORDER BY updated_at ASC LIMIT 20`,
    [now() - staleMs]
  );
  return rows.map(rowToAgentRun);
}


/** Persist enriched attachments (e.g. extracted PDF text) so parsing happens once. */
export async function updateMessageAttachments(id: string, attachments: Attachment[]) {
  await q("UPDATE messages SET attachments = $1 WHERE id = $2", [
    JSON.stringify(attachments),
    id,
  ]);
}

export async function deleteMessagesFrom(
  conversationId: string,
  messageId: string,
  opts: { pruneArtifacts?: boolean } = {}
) {
  const targetRows = await q(
    "SELECT created_at, seq FROM messages WHERE id = $1",
    [messageId]
  );
  const target = targetRows[0] as { created_at: number; seq: number } | undefined;
  if (!target) return;
  // When the tail is preserved as a branch, its artifact versions stay too —
  // pruning is only for true deletions.
  if (opts.pruneArtifacts !== false) {
    const doomed = (await q(
      "SELECT id FROM messages WHERE conversation_id = $1 AND (created_at > $2 OR (created_at = $3 AND seq >= $4))",
      [conversationId, target.created_at, target.created_at, target.seq]
    )) as unknown as { id: string }[];
    await pruneArtifactVersionsForMessages(doomed.map((m) => m.id));
  }
  await q(
    "DELETE FROM messages WHERE conversation_id = $1 AND (created_at > $2 OR (created_at = $3 AND seq >= $4))",
    [conversationId, target.created_at, target.created_at, target.seq]
  );
}

/**
 * Replace all but the most recent `keepRecent` messages with a single summary
 * message, cutting context size. Artifacts are NOT pruned — they live on.
 * Returns how many messages were folded into the summary.
 */
export async function compactConversation(
  conversationId: string,
  keepRecent: number,
  summary: string
): Promise<number> {
  const all = await listMessages(conversationId);
  if (all.length <= keepRecent) return 0;
  const toDelete = all.slice(0, all.length - keepRecent);
  const anchor = all[all.length - keepRecent].created_at - 1000;
  const ids = toDelete.map((m) => m.id);
  // Delete the old turns without touching artifact_versions.
  await q("DELETE FROM messages WHERE id = ANY($1)", [ids]);
  const summaryId = newId();
  await q(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, 'assistant', $3, $4)",
    [summaryId, conversationId, summary, anchor]
  );
  return toDelete.length;
}

// ---------- branches (ChatGPT-style edit/regenerate variants) ----------

export interface BranchRecord {
  id: string;
  conversation_id: string;
  anchor_id: string; // id of the message BEFORE the fork ('' = conversation start)
  snapshot: string; // JSON array of Message objects
  preview: string;
  created_at: number;
}

async function tailAfterAnchor(
  conversationId: string,
  anchorId: string
): Promise<Message[]> {
  const all = await listMessages(conversationId);
  if (!anchorId) return all;
  const idx = all.findIndex((m) => m.id === anchorId);
  return idx === -1 ? [] : all.slice(idx + 1);
}

/** Snapshot the tail starting at fromMessageId (inclusive) as a branch. */
export async function snapshotTailAsBranch(
  conversationId: string,
  fromMessageId: string
): Promise<BranchRecord | null> {
  const all = await listMessages(conversationId);
  const idx = all.findIndex((m) => m.id === fromMessageId);
  if (idx === -1) return null;
  const tail = all.slice(idx);
  if (tail.length === 0) return null;
  const anchorId = idx > 0 ? all[idx - 1].id : "";
  const record: BranchRecord = {
    id: newId(),
    conversation_id: conversationId,
    anchor_id: anchorId,
    snapshot: JSON.stringify(tail),
    preview: tail[0].content.slice(0, 120),
    created_at: now(),
  };
  await q(
    "INSERT INTO branches (id, conversation_id, anchor_id, snapshot, preview, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      record.id,
      record.conversation_id,
      record.anchor_id,
      record.snapshot,
      record.preview,
      record.created_at,
    ]
  );
  return record;
}

export async function listBranches(conversationId: string): Promise<BranchRecord[]> {
  return (await q(
    "SELECT * FROM branches WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId]
  )) as unknown as BranchRecord[];
}

async function restoreMessages(tail: Message[]) {
  for (const m of tail) {
    await q(
      "INSERT INTO messages (id, conversation_id, role, content, model, attachments, reasoning, annotations, images, tool_calls, tool_call_id, reasoning_ms, cost, tokens_in, tokens_out, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
      [
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.model,
        m.attachments ? JSON.stringify(m.attachments) : null,
        m.reasoning ?? null,
        m.annotations ? JSON.stringify(m.annotations) : null,
        m.images ? JSON.stringify(m.images) : null,
        m.tool_calls ? JSON.stringify(m.tool_calls) : null,
        m.tool_call_id ?? null,
        m.reasoning_ms ?? null,
        m.cost ?? null,
        m.tokens_in ?? null,
        m.tokens_out ?? null,
        m.created_at,
      ]
    );
  }
}

/**
 * Swap the live tail with a stored branch: the current tail becomes a branch
 * and the chosen branch becomes live. Returns the restored messages.
 */
export async function switchToBranch(
  conversationId: string,
  branchId: string
): Promise<Message[] | null> {
  const branchRows = await q(
    "SELECT * FROM branches WHERE id = $1 AND conversation_id = $2",
    [branchId, conversationId]
  );
  const branch = branchRows[0] as unknown as BranchRecord | undefined;
  if (!branch) return null;

  const liveTail = await tailAfterAnchor(conversationId, branch.anchor_id);
  if (liveTail.length > 0) {
    const record: BranchRecord = {
      id: newId(),
      conversation_id: conversationId,
      anchor_id: branch.anchor_id,
      snapshot: JSON.stringify(liveTail),
      preview: liveTail[0].content.slice(0, 120),
      // Preserve ordering: the outgoing live tail takes the incoming branch's slot age.
      created_at: branch.created_at,
    };
    await q(
      "INSERT INTO branches (id, conversation_id, anchor_id, snapshot, preview, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        record.id,
        record.conversation_id,
        record.anchor_id,
        record.snapshot,
        record.preview,
        record.created_at,
      ]
    );
    // Artifact versions survive branch swaps intentionally (full history kept).
    for (const m of liveTail) {
      await q("DELETE FROM messages WHERE id = $1", [m.id]);
    }
  }

  const restored = JSON.parse(branch.snapshot) as Message[];
  await restoreMessages(restored);
  await q("DELETE FROM branches WHERE id = $1", [branchId]);
  await touchConversation(conversationId);
  return restored;
}

export async function deleteBranchesFor(conversationId: string) {
  await q("DELETE FROM branches WHERE conversation_id = $1", [conversationId]);
}

// ---------- projects ----------

/** Projects the user owns plus projects shared with them. */
export async function listProjects(userId: string = DEFAULT_USER): Promise<Project[]> {
  return (await q(
    `SELECT DISTINCT p.* FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id
     WHERE p.user_id = $1 OR m.user_id = $2
     ORDER BY p.created_at DESC`,
    [userId, userId]
  )) as unknown as Project[];
}

export async function canAccessProject(
  projectId: string,
  userId: string
): Promise<boolean> {
  const project = await getProject(projectId);
  if (!project) return false;
  const owner = (project as Project & { user_id?: string }).user_id;
  if (!owner || owner === userId) return true;
  const rows = await q(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]
  );
  return rows.length > 0;
}

export async function isProjectOwner(
  projectId: string,
  userId: string
): Promise<boolean> {
  const project = (await getProject(projectId)) as
    | (Project & { user_id?: string })
    | undefined;
  return Boolean(project && (!project.user_id || project.user_id === userId));
}

export async function listProjectMembers(
  projectId: string
): Promise<{ user_id: string; email: string; name: string; added_at: number }[]> {
  return (await q(
    `SELECT m.user_id, u.email, u.name, m.added_at FROM project_members m
     JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY m.added_at ASC`,
    [projectId]
  )) as unknown as { user_id: string; email: string; name: string; added_at: number }[];
}

export async function addProjectMember(projectId: string, userId: string) {
  await q(
    "INSERT INTO project_members (project_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [projectId, userId, now()]
  );
}

export async function removeProjectMember(projectId: string, userId: string) {
  await q("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [
    projectId,
    userId,
  ]);
}

// ---------------------------------------------------------------------------
// Design systems — named brand specs applied to Design-mode builds. A user can
// have many; at most one is the default. Shares follow the project_members
// pattern: recipients get read-only access (they can apply or copy, not edit).

export async function createDesignSystem(
  userId: string,
  data: { name: string; spec: string; palette?: string | null; isDefault?: boolean }
): Promise<DesignSystem> {
  const ds: DesignSystem = {
    id: newId(),
    user_id: userId,
    name: data.name,
    spec: data.spec,
    palette: data.palette ?? null,
    is_default: data.isDefault ? 1 : 0,
    created_at: now(),
    updated_at: now(),
  };
  if (data.isDefault) {
    await q("UPDATE design_systems SET is_default = 0 WHERE user_id = $1", [userId]);
  }
  await q(
    `INSERT INTO design_systems (id, user_id, name, spec, palette, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ds.id, ds.user_id, ds.name, ds.spec, ds.palette, ds.is_default, ds.created_at, ds.updated_at]
  );
  return ds;
}

/** Own systems plus ones shared with the user (marked shared + owner name). */
export async function listDesignSystems(userId: string): Promise<DesignSystem[]> {
  const own = (await q(
    "SELECT * FROM design_systems WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC",
    [userId]
  )) as unknown as DesignSystem[];
  const shared = (await q(
    `SELECT d.*, u.name AS owner_name FROM design_system_shares s
     JOIN design_systems d ON d.id = s.design_system_id
     JOIN users u ON u.id = d.user_id
     WHERE s.user_id = $1 ORDER BY d.updated_at DESC`,
    [userId]
  )) as unknown as DesignSystem[];
  return [...own, ...shared.map((s) => ({ ...s, shared: true, is_default: 0 }))];
}

export async function getDesignSystem(id: string): Promise<DesignSystem | undefined> {
  const rows = await q("SELECT * FROM design_systems WHERE id = $1", [id]);
  return rows[0] as unknown as DesignSystem | undefined;
}

/** Owner or share recipient can read/apply the system. */
export async function canAccessDesignSystem(id: string, userId: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  if (ds.user_id === userId) return true;
  const rows = await q(
    "SELECT 1 FROM design_system_shares WHERE design_system_id = $1 AND user_id = $2",
    [id, userId]
  );
  return rows.length > 0;
}

export async function updateDesignSystem(
  id: string,
  fields: Partial<Pick<DesignSystem, "name" | "spec" | "palette">>
) {
  const ds = await getDesignSystem(id);
  if (!ds) return;
  const merged = { ...ds, ...fields, updated_at: now() };
  await q(
    "UPDATE design_systems SET name = $1, spec = $2, palette = $3, updated_at = $4 WHERE id = $5",
    [merged.name, merged.spec, merged.palette, merged.updated_at, id]
  );
}

/** Make `id` the user's default (or clear the default entirely with null). */
export async function setDefaultDesignSystem(userId: string, id: string | null) {
  await q("UPDATE design_systems SET is_default = 0 WHERE user_id = $1", [userId]);
  if (id) {
    await q(
      "UPDATE design_systems SET is_default = 1 WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
  }
}

export async function deleteDesignSystem(id: string) {
  await q("DELETE FROM design_system_shares WHERE design_system_id = $1", [id]);
  await q("DELETE FROM design_systems WHERE id = $1", [id]);
}

export async function shareDesignSystem(id: string, recipientId: string) {
  await q(
    "INSERT INTO design_system_shares (design_system_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [id, recipientId, now()]
  );
}

export async function unshareDesignSystem(id: string, recipientId: string) {
  await q(
    "DELETE FROM design_system_shares WHERE design_system_id = $1 AND user_id = $2",
    [id, recipientId]
  );
}

export async function listDesignSystemShares(
  id: string
): Promise<{ user_id: string; email: string; name: string }[]> {
  return (await q(
    `SELECT s.user_id, u.email, u.name FROM design_system_shares s
     JOIN users u ON u.id = s.user_id WHERE s.design_system_id = $1 ORDER BY s.added_at ASC`,
    [id]
  )) as unknown as { user_id: string; email: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Artifact shares — user-to-user. Recipients see the artifact in "Shared with
// you" and can open it as an editable copy in their own Design workspace.

export async function shareArtifactWithUser(artifactId: string, recipientId: string) {
  await q(
    "INSERT INTO artifact_shares (artifact_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [artifactId, recipientId, now()]
  );
}

export async function unshareArtifactWithUser(artifactId: string, recipientId: string) {
  await q("DELETE FROM artifact_shares WHERE artifact_id = $1 AND user_id = $2", [
    artifactId,
    recipientId,
  ]);
}

export async function listArtifactShares(
  artifactId: string
): Promise<{ user_id: string; email: string; name: string }[]> {
  return (await q(
    `SELECT s.user_id, u.email, u.name FROM artifact_shares s
     JOIN users u ON u.id = s.user_id WHERE s.artifact_id = $1 ORDER BY s.added_at ASC`,
    [artifactId]
  )) as unknown as { user_id: string; email: string; name: string }[];
}

/** True when the artifact was shared to this user (not ownership). */
export async function isArtifactSharedWith(
  artifactId: string,
  userId: string
): Promise<boolean> {
  const rows = await q(
    "SELECT 1 FROM artifact_shares WHERE artifact_id = $1 AND user_id = $2",
    [artifactId, userId]
  );
  return rows.length > 0;
}

/** Artifacts shared with the user, newest first, with the owner's name. */
export async function listArtifactsSharedWith(userId: string): Promise<
  {
    artifact_id: string;
    identifier: string;
    type: string;
    title: string;
    language: string | null;
    owner_name: string;
    shared_at: number;
    updated_at: number;
  }[]
> {
  return (await q(
    `SELECT a.id AS artifact_id, a.identifier, a.type, a.title, a.language,
            u.name AS owner_name, s.added_at AS shared_at, a.updated_at
     FROM artifact_shares s
     JOIN artifacts a ON a.id = s.artifact_id
     JOIN conversations c ON c.id = a.conversation_id
     JOIN users u ON u.id = c.user_id
     WHERE s.user_id = $1 ORDER BY s.added_at DESC`,
    [userId]
  )) as unknown as {
    artifact_id: string;
    identifier: string;
    type: string;
    title: string;
    language: string | null;
    owner_name: string;
    shared_at: number;
    updated_at: number;
  }[];
}

export async function getProject(id: string): Promise<Project | undefined> {
  const rows = await q("SELECT * FROM projects WHERE id = $1", [id]);
  return rows[0] as unknown as Project | undefined;
}

export async function createProject(
  name: string,
  instructions = "",
  userId: string = DEFAULT_USER
): Promise<Project> {
  const project = { id: newId(), name, instructions, user_id: userId, created_at: now() };
  await q(
    "INSERT INTO projects (id, name, instructions, user_id, created_at) VALUES ($1, $2, $3, $4, $5)",
    [project.id, project.name, project.instructions, project.user_id, project.created_at]
  );
  return project as Project;
}

export async function updateProject(
  id: string,
  fields: Partial<Pick<Project, "name" | "instructions">>
) {
  const project = await getProject(id);
  if (!project) return;
  const merged = { ...project, ...fields };
  await q("UPDATE projects SET name = $1, instructions = $2 WHERE id = $3", [
    merged.name,
    merged.instructions,
    id,
  ]);
}

export async function deleteProject(id: string) {
  await q("DELETE FROM project_members WHERE project_id = $1", [id]);
  await q("DELETE FROM project_files WHERE project_id = $1", [id]);
  await q("UPDATE conversations SET project_id = NULL WHERE project_id = $1", [id]);
  await q("DELETE FROM projects WHERE id = $1", [id]);
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  return (await q(
    "SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at ASC",
    [projectId]
  )) as unknown as ProjectFile[];
}

export async function addProjectFile(
  projectId: string,
  name: string,
  content: string
): Promise<ProjectFile> {
  const file: ProjectFile = {
    id: newId(),
    project_id: projectId,
    name,
    content,
    created_at: now(),
  };
  await q(
    "INSERT INTO project_files (id, project_id, name, content, created_at) VALUES ($1, $2, $3, $4, $5)",
    [file.id, file.project_id, file.name, file.content, file.created_at]
  );
  return file;
}

export async function deleteProjectFile(id: string, projectId?: string) {
  // When projectId is given, scope the delete to it so a caller can't remove a
  // file that belongs to a different (foreign) project.
  if (projectId) {
    await q("DELETE FROM project_files WHERE id = $1 AND project_id = $2", [id, projectId]);
  } else {
    await q("DELETE FROM project_files WHERE id = $1", [id]);
  }
}

// ---------- artifacts ----------

import type { ArtifactRecord, ArtifactVersion, ArtifactType } from "./artifact-shared";

export async function getArtifactByIdentifier(
  conversationId: string,
  identifier: string
): Promise<ArtifactRecord | undefined> {
  const rows = await q(
    "SELECT * FROM artifacts WHERE conversation_id = $1 AND identifier = $2",
    [conversationId, identifier]
  );
  return rows[0] as unknown as ArtifactRecord | undefined;
}

export async function getArtifact(id: string): Promise<ArtifactRecord | undefined> {
  const rows = await q("SELECT * FROM artifacts WHERE id = $1", [id]);
  return rows[0] as unknown as ArtifactRecord | undefined;
}

export async function listArtifacts(conversationId: string): Promise<ArtifactRecord[]> {
  return (await q(
    "SELECT * FROM artifacts WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId]
  )) as unknown as ArtifactRecord[];
}

export async function listArtifactVersions(
  artifactId: string
): Promise<ArtifactVersion[]> {
  return (await q(
    "SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version ASC",
    [artifactId]
  )) as unknown as ArtifactVersion[];
}

export async function getArtifactVersion(
  artifactId: string,
  version?: number | null
): Promise<ArtifactVersion | undefined> {
  if (version != null) {
    const rows = await q(
      "SELECT * FROM artifact_versions WHERE artifact_id = $1 AND version = $2",
      [artifactId, version]
    );
    return rows[0] as unknown as ArtifactVersion | undefined;
  }
  const rows = await q(
    "SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1",
    [artifactId]
  );
  return rows[0] as unknown as ArtifactVersion | undefined;
}

export async function upsertArtifact(
  conversationId: string,
  identifier: string,
  fields: { type: ArtifactType; language: string | null; title: string }
): Promise<ArtifactRecord> {
  const existing = await getArtifactByIdentifier(conversationId, identifier);
  if (existing) {
    await q(
      "UPDATE artifacts SET type = $1, language = $2, title = $3, updated_at = $4 WHERE id = $5",
      [fields.type, fields.language, fields.title, now(), existing.id]
    );
    return (await getArtifact(existing.id))!;
  }
  const record: ArtifactRecord = {
    id: newId(),
    conversation_id: conversationId,
    identifier,
    type: fields.type,
    language: fields.language,
    title: fields.title,
    share_id: null,
    share_mode: null,
    pinned_version: null,
    created_at: now(),
    updated_at: now(),
  };
  await q(
    `INSERT INTO artifacts (id, conversation_id, identifier, type, language, title, share_id, share_mode, pinned_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      record.id,
      record.conversation_id,
      record.identifier,
      record.type,
      record.language,
      record.title,
      record.share_id,
      record.share_mode,
      record.pinned_version,
      record.created_at,
      record.updated_at,
    ]
  );
  return record;
}

export async function addArtifactVersion(
  artifactId: string,
  content: string,
  messageId: string | null
): Promise<ArtifactVersion> {
  const latest = await getArtifactVersion(artifactId);
  const version: ArtifactVersion = {
    id: newId(),
    artifact_id: artifactId,
    version: (latest?.version ?? 0) + 1,
    content,
    message_id: messageId,
    created_at: now(),
  };
  await q(
    "INSERT INTO artifact_versions (id, artifact_id, version, content, message_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      version.id,
      version.artifact_id,
      version.version,
      version.content,
      version.message_id,
      version.created_at,
    ]
  );
  await q("UPDATE artifacts SET updated_at = $1 WHERE id = $2", [now(), artifactId]);
  return version;
}

export async function setArtifactShare(
  id: string,
  share: {
    share_id: string | null;
    share_mode: "latest" | "pinned" | null;
    pinned_version: number | null;
  }
) {
  await q(
    "UPDATE artifacts SET share_id = $1, share_mode = $2, pinned_version = $3, updated_at = $4 WHERE id = $5",
    [share.share_id, share.share_mode, share.pinned_version, now(), id]
  );
}

export async function getArtifactByShareId(
  shareId: string
): Promise<(ArtifactRecord & { resolved: ArtifactVersion | undefined }) | undefined> {
  const rows = await q("SELECT * FROM artifacts WHERE share_id = $1", [shareId]);
  const record = rows[0] as unknown as ArtifactRecord | undefined;
  if (!record) return undefined;
  const resolved =
    record.share_mode === "pinned"
      ? await getArtifactVersion(record.id, record.pinned_version)
      : await getArtifactVersion(record.id);
  return { ...record, resolved };
}

export async function deleteArtifactsForConversation(conversationId: string) {
  const ids = (await q("SELECT id FROM artifacts WHERE conversation_id = $1", [
    conversationId,
  ])) as unknown as { id: string }[];
  for (const { id } of ids) {
    await q("DELETE FROM artifact_versions WHERE artifact_id = $1", [id]);
    await q("DELETE FROM artifacts WHERE id = $1", [id]);
  }
}

/** Remove versions created by deleted messages; drop artifacts left with no versions. */
export async function pruneArtifactVersionsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return;
  await q("DELETE FROM artifact_versions WHERE message_id = ANY($1)", [messageIds]);
  await q(
    "DELETE FROM artifacts WHERE id NOT IN (SELECT DISTINCT artifact_id FROM artifact_versions)"
  );
}

// ---------- memories ----------

export interface MemoryRecord {
  id: string;
  content: string;
  created_at: number;
}

export async function listMemories(
  userId: string = DEFAULT_USER
): Promise<MemoryRecord[]> {
  return (await q(
    "SELECT * FROM memories WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  )) as unknown as MemoryRecord[];
}

export async function addMemory(
  content: string,
  userId: string = DEFAULT_USER
): Promise<MemoryRecord> {
  const trimmed = content.trim();
  const existingRows = await q(
    "SELECT * FROM memories WHERE user_id = $1 AND content = $2",
    [userId, trimmed]
  );
  const existing = existingRows[0] as unknown as MemoryRecord | undefined;
  if (existing) return existing;
  const record = { id: newId(), content: trimmed, user_id: userId, created_at: now() };
  await q(
    "INSERT INTO memories (id, content, user_id, created_at) VALUES ($1, $2, $3, $4)",
    [record.id, record.content, record.user_id, record.created_at]
  );
  return record as MemoryRecord;
}

export async function updateMemory(id: string, content: string) {
  await q("UPDATE memories SET content = $1 WHERE id = $2", [content.trim(), id]);
}

export async function deleteMemory(id: string) {
  await q("DELETE FROM memories WHERE id = $1", [id]);
}

/** Resolve a memory by id prefix (the model sees 8-char handles). */
export async function findMemoryByPrefix(
  prefix: string,
  userId: string = DEFAULT_USER
): Promise<MemoryRecord | undefined> {
  if (!prefix) return undefined;
  return (await listMemories(userId)).find((m) => m.id.startsWith(prefix));
}

// ---------- shared chats ----------

export interface SharedChat {
  id: string;
  conversation_id: string;
  title: string;
  snapshot: string;
  created_at: number;
}

/** Copy a conversation and its messages into a new one owned by the user. */
export async function forkConversation(
  sourceId: string,
  userId: string = DEFAULT_USER
): Promise<Conversation | null> {
  const src = await getConversation(sourceId);
  if (!src) return null;
  const conv = await createConversation(src.model, src.project_id ?? null, false, userId);
  await updateConversation(conv.id, { title: `${src.title} (copy)` });
  const msgs = await listMessages(sourceId);
  for (const m of msgs) {
    await addMessage(conv.id, m.role, m.content, m.model, m.attachments, {
      reasoning: m.reasoning ?? null,
      annotations: m.annotations ?? null,
      images: m.images ?? null,
      tool_calls: m.tool_calls ?? null,
      tool_call_id: m.tool_call_id ?? null,
      cost: m.cost ?? null,
      tokens_in: m.tokens_in ?? null,
      tokens_out: m.tokens_out ?? null,
    });
  }
  return await getConversation(conv.id) ?? conv;
}

export async function createSharedChat(
  conversationId: string
): Promise<SharedChat | null> {
  const conv = await getConversation(conversationId);
  if (!conv) return null;
  const snapshot = JSON.stringify(
    (await listMessages(conversationId)).map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model,
      images: m.images,
      created_at: m.created_at,
    }))
  );
  const record = {
    id: crypto.randomBytes(8).toString("base64url"),
    conversation_id: conversationId,
    title: conv.title,
    snapshot,
    user_id: conv.user_id ?? DEFAULT_USER,
    created_at: now(),
  };
  await q(
    "INSERT INTO shared_chats (id, conversation_id, title, snapshot, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      record.id,
      record.conversation_id,
      record.title,
      record.snapshot,
      record.user_id,
      record.created_at,
    ]
  );
  return record as SharedChat;
}

export async function getSharedChat(id: string): Promise<SharedChat | undefined> {
  const rows = await q("SELECT * FROM shared_chats WHERE id = $1", [id]);
  return rows[0] as unknown as SharedChat | undefined;
}

export async function deleteSharedChatsFor(conversationId: string) {
  await q("DELETE FROM shared_chats WHERE conversation_id = $1", [conversationId]);
}

// ---------- model providers (Azure / Bedrock / Google / custom OpenAI-compatible) ----------

export interface ProviderRecord {
  id: string;
  user_id: string;
  kind: "openai" | "anthropic" | "azure" | "bedrock" | "google" | "custom";
  name: string;
  config: string; // JSON: endpoint/region/apiKey/apiVersion/models[]
  enabled: number;
  created_at: number;
}

export async function listProviders(
  userId: string = DEFAULT_USER
): Promise<ProviderRecord[]> {
  return (await q(
    "SELECT * FROM providers WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  )) as unknown as ProviderRecord[];
}

export async function getProvider(id: string): Promise<ProviderRecord | undefined> {
  const rows = await q("SELECT * FROM providers WHERE id = $1", [id]);
  return rows[0] as unknown as ProviderRecord | undefined;
}

export async function createProvider(
  input: { kind: ProviderRecord["kind"]; name: string; config: Record<string, unknown> },
  userId: string = DEFAULT_USER
): Promise<ProviderRecord> {
  const record: ProviderRecord = {
    id: newId(),
    user_id: userId,
    kind: input.kind,
    name: input.name,
    config: JSON.stringify(input.config),
    enabled: 1,
    created_at: now(),
  };
  await q(
    "INSERT INTO providers (id, user_id, kind, name, config, enabled, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      record.id,
      record.user_id,
      record.kind,
      record.name,
      record.config,
      record.enabled,
      record.created_at,
    ]
  );
  return record;
}

export async function updateProvider(
  id: string,
  fields: Partial<Pick<ProviderRecord, "enabled" | "name" | "config">>
) {
  const record = await getProvider(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  await q("UPDATE providers SET name=$1, config=$2, enabled=$3 WHERE id=$4", [
    merged.name,
    merged.config,
    merged.enabled,
    id,
  ]);
}

export async function deleteProvider(id: string) {
  await q("DELETE FROM providers WHERE id = $1", [id]);
}

// ---------- connectors (MCP servers) ----------

export interface Connector {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string | null; // JSON array
  url: string | null;
  headers: string | null; // JSON object
  oauth_data: string | null; // JSON: tokens, client info, verifier, redirect
  tools_cache: string | null; // JSON: [{name, description}] discovered on last test
  last_tested: number | null;
  enabled: number;
  user_id: string;
  created_at: number;
}

/** Persist the tool list discovered by a successful connector test, so the UI
 *  can show a server's functions instantly without reconnecting each time. */
export async function setConnectorTools(
  id: string,
  tools: { name: string; description: string }[]
) {
  await q("UPDATE connectors SET tools_cache = $1, last_tested = $2 WHERE id = $3", [
    JSON.stringify(tools),
    now(),
    id,
  ]);
}

export async function getConnectorOAuth(id: string): Promise<Record<string, unknown>> {
  const row = await getConnector(id);
  try {
    return row?.oauth_data ? JSON.parse(row.oauth_data) : {};
  } catch {
    return {};
  }
}

export async function saveConnectorOAuth(id: string, patch: Record<string, unknown>) {
  const merged = { ...(await getConnectorOAuth(id)), ...patch };
  await q("UPDATE connectors SET oauth_data = $1 WHERE id = $2", [
    JSON.stringify(merged),
    id,
  ]);
}

export async function listConnectors(
  userId: string = DEFAULT_USER
): Promise<Connector[]> {
  return (await q(
    "SELECT * FROM connectors WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  )) as unknown as Connector[];
}

export async function getConnector(id: string): Promise<Connector | undefined> {
  const rows = await q("SELECT * FROM connectors WHERE id = $1", [id]);
  return rows[0] as unknown as Connector | undefined;
}

export async function createConnector(
  input: {
    name: string;
    transport: "stdio" | "http";
    command?: string | null;
    args?: string | null;
    url?: string | null;
    headers?: string | null;
  },
  userId: string = DEFAULT_USER
): Promise<Connector> {
  const record = {
    id: newId(),
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: input.args ?? null,
    url: input.url ?? null,
    headers: input.headers ?? null,
    oauth_data: null,
    tools_cache: null,
    last_tested: null,
    enabled: 1,
    user_id: userId,
    created_at: now(),
  };
  await q(
    "INSERT INTO connectors (id, name, transport, command, args, url, headers, oauth_data, enabled, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      record.id,
      record.name,
      record.transport,
      record.command,
      record.args,
      record.url,
      record.headers,
      record.oauth_data,
      record.enabled,
      record.user_id,
      record.created_at,
    ]
  );
  return record as Connector;
}

export async function updateConnector(id: string, fields: Partial<Connector>) {
  const record = await getConnector(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  await q(
    "UPDATE connectors SET name=$1, transport=$2, command=$3, args=$4, url=$5, headers=$6, enabled=$7 WHERE id=$8",
    [
      merged.name,
      merged.transport,
      merged.command,
      merged.args,
      merged.url,
      merged.headers,
      merged.enabled,
      id,
    ]
  );
}

export async function deleteConnector(id: string) {
  await q("DELETE FROM connectors WHERE id = $1", [id]);
}

// ---------- http tools (user-defined REST endpoints) ----------

function rowToHttpTool(r: Record<string, unknown>): HttpTool & { auth_secret: string | null } {
  const safeJson = <T,>(s: unknown, fallback: T): T => {
    try {
      return s ? (JSON.parse(s as string) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    method: (r.method as string) ?? "GET",
    url_template: r.url_template as string,
    params: safeJson<HttpToolParam[]>(r.params, []),
    headers: safeJson<Record<string, string>>(r.headers, {}),
    auth: safeJson<HttpToolAuth>(r.auth, { type: "none" }),
    auth_secret: (r.auth_secret as string) ?? null,
    body_mode: ((r.body_mode as string) ?? "auto") as "auto" | "template",
    body_template: (r.body_template as string) ?? null,
    response_extract: (r.response_extract as string) ?? null,
    max_response_bytes: Number(r.max_response_bytes ?? 24576),
    auto_run: Number(r.auto_run ?? 0),
    source: ((r.source as string) ?? "manual") as "manual" | "openapi",
    openapi_group: (r.openapi_group as string) ?? null,
    enabled: Number(r.enabled ?? 1),
    created_at: Number(r.created_at ?? 0),
  };
}

/** List a user's HTTP tools. Secrets are stripped unless withSecret is set (server-only). */
export async function listHttpTools(
  userId: string,
  withSecret = false
): Promise<HttpTool[]> {
  const rows = await q(
    "SELECT * FROM http_tools WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map((r) => {
    const t = rowToHttpTool(r as Record<string, unknown>);
    return withSecret ? t : redactHttpTool(t);
  });
}

export async function getHttpTool(
  id: string,
  userId: string
): Promise<(HttpTool & { auth_secret: string | null }) | undefined> {
  const rows = await q("SELECT * FROM http_tools WHERE id = $1 AND user_id = $2", [id, userId]);
  return rows[0] ? rowToHttpTool(rows[0] as Record<string, unknown>) : undefined;
}

export async function getHttpToolByName(
  userId: string,
  name: string
): Promise<(HttpTool & { auth_secret: string | null }) | undefined> {
  const rows = await q(
    "SELECT * FROM http_tools WHERE user_id = $1 AND name = $2 AND enabled = 1",
    [userId, name]
  );
  return rows[0] ? rowToHttpTool(rows[0] as Record<string, unknown>) : undefined;
}

/** Remove the stored secret + flag whether one exists, for safe client responses. */
export function redactHttpTool(t: HttpTool & { auth_secret?: string | null }): HttpTool {
  const { auth_secret, ...rest } = t;
  return { ...rest, auth: { ...rest.auth, hasSecret: Boolean(auth_secret) } };
}

export async function createHttpTool(
  userId: string,
  t: Omit<HttpTool, "id" | "user_id" | "created_at"> & { auth_secret?: string | null }
): Promise<HttpTool> {
  const id = newId();
  const createdAt = now();
  await q(
    `INSERT INTO http_tools
      (id, user_id, name, description, method, url_template, params, headers, auth, auth_secret,
       body_mode, body_template, response_extract, max_response_bytes, auto_run, source, openapi_group, enabled, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      userId,
      t.name,
      t.description,
      t.method,
      t.url_template,
      JSON.stringify(t.params ?? []),
      JSON.stringify(t.headers ?? {}),
      JSON.stringify(t.auth ?? { type: "none" }),
      t.auth_secret ?? null,
      t.body_mode ?? "auto",
      t.body_template ?? null,
      t.response_extract ?? null,
      t.max_response_bytes ?? 24576,
      t.auto_run ?? 0,
      t.source ?? "manual",
      t.openapi_group ?? null,
      t.enabled ?? 1,
      createdAt,
    ]
  );
  return { ...(t as HttpTool), id, user_id: userId, created_at: createdAt };
}

export async function updateHttpTool(
  id: string,
  userId: string,
  fields: Partial<HttpTool & { auth_secret: string | null }>
) {
  const cur = await getHttpTool(id, userId);
  if (!cur) return;
  const m = { ...cur, ...fields };
  await q(
    `UPDATE http_tools SET name=$1, description=$2, method=$3, url_template=$4, params=$5, headers=$6,
       auth=$7, auth_secret=$8, body_mode=$9, body_template=$10, response_extract=$11,
       max_response_bytes=$12, auto_run=$13, enabled=$14 WHERE id=$15 AND user_id=$16`,
    [
      m.name,
      m.description,
      m.method,
      m.url_template,
      JSON.stringify(m.params ?? []),
      JSON.stringify(m.headers ?? {}),
      JSON.stringify(m.auth ?? { type: "none" }),
      // keep the existing secret when the caller didn't supply a new one
      fields.auth_secret === undefined ? cur.auth_secret : fields.auth_secret,
      m.body_mode,
      m.body_template ?? null,
      m.response_extract ?? null,
      m.max_response_bytes,
      m.auto_run,
      m.enabled,
      id,
      userId,
    ]
  );
}

export async function deleteHttpTool(id: string, userId: string) {
  await q("DELETE FROM http_tools WHERE id = $1 AND user_id = $2", [id, userId]);
}

export async function deleteHttpToolGroup(openapiGroup: string, userId: string) {
  await q("DELETE FROM http_tools WHERE openapi_group = $1 AND user_id = $2", [openapiGroup, userId]);
}

// ---------- skills ----------

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  instructions: string;
  connector_ids: string | null; // JSON array of connector ids this skill bundles
  http_tool_ids: string | null; // JSON array of http-tool ids this skill bundles
  enabled: number;
  user_id: string;
  created_at: number;
}

export async function listSkills(userId: string = DEFAULT_USER): Promise<SkillRecord[]> {
  return (await q(
    "SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  )) as unknown as SkillRecord[];
}

export async function getSkill(id: string): Promise<SkillRecord | undefined> {
  const rows = await q("SELECT * FROM skills WHERE id = $1", [id]);
  return rows[0] as unknown as SkillRecord | undefined;
}

export async function createSkill(
  input: {
    name: string;
    description: string;
    instructions: string;
    connectorIds?: string[];
    httpToolIds?: string[];
  },
  userId: string = DEFAULT_USER
): Promise<SkillRecord> {
  const record = {
    id: newId(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    connector_ids: input.connectorIds?.length ? JSON.stringify(input.connectorIds) : null,
    http_tool_ids: input.httpToolIds?.length ? JSON.stringify(input.httpToolIds) : null,
    enabled: 1,
    user_id: userId,
    created_at: now(),
  };
  await q(
    "INSERT INTO skills (id, name, description, instructions, connector_ids, http_tool_ids, enabled, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      record.id,
      record.name,
      record.description,
      record.instructions,
      record.connector_ids,
      record.http_tool_ids,
      record.enabled,
      record.user_id,
      record.created_at,
    ]
  );
  return record as SkillRecord;
}

export async function updateSkill(id: string, fields: Partial<SkillRecord>) {
  const record = await getSkill(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  await q(
    "UPDATE skills SET name=$1, description=$2, instructions=$3, connector_ids=$4, http_tool_ids=$5, enabled=$6 WHERE id=$7",
    [merged.name, merged.description, merged.instructions, merged.connector_ids, merged.http_tool_ids, merged.enabled, id]
  );
}

export async function deleteSkill(id: string) {
  await q("DELETE FROM skills WHERE id = $1", [id]);
}

// ---------- push subscriptions ----------

export interface PushSubscriptionRecord {
  endpoint: string;
  user_id: string;
  subscription: string; // JSON: the browser PushSubscription
  created_at: number;
}

export async function savePushSubscription(
  subscription: { endpoint: string },
  userId: string = DEFAULT_USER
) {
  await q(
    "INSERT INTO push_subscriptions (endpoint, user_id, subscription, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT(endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, user_id = EXCLUDED.user_id",
    [subscription.endpoint, userId, JSON.stringify(subscription), now()]
  );
}

export async function listPushSubscriptions(
  userId: string = DEFAULT_USER
): Promise<PushSubscriptionRecord[]> {
  return (await q("SELECT * FROM push_subscriptions WHERE user_id = $1", [
    userId,
  ])) as unknown as PushSubscriptionRecord[];
}

export async function deletePushSubscription(endpoint: string, userId?: string) {
  if (userId) {
    await q("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [
      endpoint,
      userId,
    ]);
  } else {
    await q("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
  }
}

// ---------- scheduled tasks ----------

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule_kind: "interval" | "daily";
  interval_minutes: number | null;
  daily_time: string | null; // "HH:MM" local time
  web_search: number;
  model: string | null;
  enabled: number;
  next_run: number;
  last_run: number | null;
  last_conversation_id: string | null;
  last_error: string | null;
  user_id?: string;
  created_at: number;
}

export function computeNextRun(
  kind: "interval" | "daily",
  intervalMinutes: number | null,
  dailyTime: string | null,
  from = Date.now()
): number {
  if (kind === "interval") {
    const minutes = Math.max(5, intervalMinutes ?? 60);
    return from + minutes * 60_000;
  }
  const [h, m] = (dailyTime ?? "09:00").split(":").map(Number);
  const next = new Date(from);
  next.setHours(h || 0, m || 0, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export async function listScheduledTasks(
  userId: string = DEFAULT_USER
): Promise<ScheduledTask[]> {
  return (await q(
    "SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  )) as unknown as ScheduledTask[];
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | undefined> {
  const rows = await q("SELECT * FROM scheduled_tasks WHERE id = $1", [id]);
  return rows[0] as unknown as ScheduledTask | undefined;
}

export async function listDueTasks(asOf = Date.now()): Promise<ScheduledTask[]> {
  return (await q(
    "SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run <= $1",
    [asOf]
  )) as unknown as ScheduledTask[];
}

export async function createScheduledTask(
  input: {
    name: string;
    prompt: string;
    schedule_kind: "interval" | "daily";
    interval_minutes?: number | null;
    daily_time?: string | null;
    web_search?: boolean;
    model?: string | null;
  },
  userId: string = DEFAULT_USER
): Promise<ScheduledTask> {
  const task: ScheduledTask = {
    user_id: userId,
    id: newId(),
    name: input.name,
    prompt: input.prompt,
    schedule_kind: input.schedule_kind,
    interval_minutes: input.interval_minutes ?? null,
    daily_time: input.daily_time ?? null,
    web_search: input.web_search ? 1 : 0,
    model: input.model ?? null,
    enabled: 1,
    next_run: computeNextRun(
      input.schedule_kind,
      input.interval_minutes ?? null,
      input.daily_time ?? null
    ),
    last_run: null,
    last_conversation_id: null,
    last_error: null,
    created_at: now(),
  };
  await q(
    `INSERT INTO scheduled_tasks (id, name, prompt, schedule_kind, interval_minutes, daily_time, web_search, model, enabled, next_run, last_run, last_conversation_id, last_error, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      task.id,
      task.name,
      task.prompt,
      task.schedule_kind,
      task.interval_minutes,
      task.daily_time,
      task.web_search,
      task.model,
      task.enabled,
      task.next_run,
      task.last_run,
      task.last_conversation_id,
      task.last_error,
      task.user_id,
      task.created_at,
    ]
  );
  return task;
}

export async function updateScheduledTask(id: string, fields: Partial<ScheduledTask>) {
  const task = await getScheduledTask(id);
  if (!task) return;
  const merged = { ...task, ...fields };
  await q(
    `UPDATE scheduled_tasks SET name=$1, prompt=$2, schedule_kind=$3, interval_minutes=$4, daily_time=$5, web_search=$6, model=$7, enabled=$8, next_run=$9, last_run=$10, last_conversation_id=$11, last_error=$12 WHERE id=$13`,
    [
      merged.name,
      merged.prompt,
      merged.schedule_kind,
      merged.interval_minutes,
      merged.daily_time,
      merged.web_search,
      merged.model,
      merged.enabled,
      merged.next_run,
      merged.last_run,
      merged.last_conversation_id,
      merged.last_error,
      id,
    ]
  );
}

export async function deleteScheduledTask(id: string) {
  await q("DELETE FROM scheduled_tasks WHERE id = $1", [id]);
}

// ---------- platform API keys ----------

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
}

const hashKey = (key: string) =>
  crypto.createHash("sha256").update(key).digest("hex");

export async function createPlatformApiKey(
  name: string,
  userId: string = DEFAULT_USER
): Promise<{ record: ApiKeyRecord; key: string }> {
  const key = "lbd-" + crypto.randomBytes(24).toString("base64url");
  const record: ApiKeyRecord = {
    id: newId(),
    name,
    key_prefix: key.slice(0, 10),
    created_at: now(),
    last_used_at: null,
  };
  await q(
    "INSERT INTO api_keys (id, name, key_hash, key_prefix, user_id, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, NULL)",
    [record.id, record.name, hashKey(key), record.key_prefix, userId, record.created_at]
  );
  return { record, key };
}

export async function listPlatformApiKeys(
  userId: string = DEFAULT_USER
): Promise<ApiKeyRecord[]> {
  return (await q(
    "SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  )) as unknown as ApiKeyRecord[];
}

export async function deletePlatformApiKey(id: string, userId?: string) {
  if (userId) {
    await q("DELETE FROM api_keys WHERE id = $1 AND user_id = $2", [id, userId]);
  } else {
    await q("DELETE FROM api_keys WHERE id = $1", [id]);
  }
}

/** Returns the owning user's id when valid, null otherwise. */
export async function verifyPlatformApiKey(key: string): Promise<string | null> {
  const rows = await q("SELECT id, user_id FROM api_keys WHERE key_hash = $1", [
    hashKey(key),
  ]);
  const row = rows[0] as { id: string; user_id: string } | undefined;
  if (!row) return null;
  await q("UPDATE api_keys SET last_used_at = $1 WHERE id = $2", [now(), row.id]);
  return row.user_id || DEFAULT_USER;
}
