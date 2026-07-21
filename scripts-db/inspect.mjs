import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const tables = await sql`
  SELECT table_name,
    (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema='public') AS cols
  FROM information_schema.tables t
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;
for (const t of tables) {
  const [{ n }] = await sql.query(`SELECT COUNT(*)::int AS n FROM "${t.table_name}"`);
  console.log(`${t.table_name} [${n} rows]: ${t.cols.slice(0, 120)}`);
}
