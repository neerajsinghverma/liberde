import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

// Children before parents; ONLY Liberde-created tables.
const LIBERDE_TABLES = [
  "messages", "branches", "artifact_versions", "artifacts", "shared_chats",
  "conversations", "project_files", "project_members", "projects",
  "sessions", "api_keys", "connectors", "memories", "providers",
  "scheduled_tasks", "settings", "skills", "users",
];

for (const table of LIBERDE_TABLES) {
  const exists = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}`;
  if (exists.length === 0) {
    console.log(`already gone: ${table}`);
    continue;
  }
  const [{ n }] = await sql.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  if (n !== 0) {
    console.log(`SKIP ${table}: has ${n} rows — refusing to drop non-empty table`);
    continue;
  }
  await sql.query(`DROP TABLE "${table}"`);
  console.log(`dropped ${table}`);
}

const remaining = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
console.log("\nremaining tables:", remaining.map((r) => r.table_name).join(", "));
