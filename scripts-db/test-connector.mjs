import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
// Simulate exactly what POST /api/connectors inserts.
const id = crypto.randomUUID();
await sql.query(
  "INSERT INTO connectors (id, name, transport, command, args, url, headers, oauth_data, enabled, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
  [id, "probe", "http", null, null, "https://example.com/mcp", null, null, 1, "probe-user", Date.now()]
);
const rows = await sql.query("SELECT id, name FROM connectors WHERE id = $1", [id]);
console.log("insert+select ok:", rows.rows?.[0] ?? rows[0]);
await sql.query("DELETE FROM connectors WHERE id = $1", [id]);
console.log("cleaned up");
