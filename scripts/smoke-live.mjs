#!/usr/bin/env node
/**
 * Smoke the deployed site: does every public surface answer, and does every
 * private one refuse?
 *
 * The second half matters more than the first. An endpoint that returns data
 * without a session is the worst bug this codebase could have, and it is
 * invisible to every other check here — types, builds and the reachability
 * audit all pass happily while a route leaks. So each private route is called
 * with no cookie and must answer 401 or 403; a 200 is a failure, and so is a
 * 500, because a route that crashes instead of refusing has not been reached
 * by its own auth check.
 *
 *   node scripts/smoke-live.mjs [https://liberde.ai]
 */

const BASE = process.argv[2] ?? "https://liberde.ai";

const PUBLIC = [
  ["/", 200],
  ["/login", 200],
  ["/changelog.html", 200],
  ["/landing.html", 200],
  ["/privacy", 200],
  ["/terms", 200],
  ["/manifest.json", 200],
];

/** Signed-in-only. Called with no cookie: must refuse, never serve. */
const PRIVATE = [
  "/api/settings",
  "/api/conversations",
  "/api/projects",
  "/api/skills",
  "/api/agents",
  "/api/artifacts",
  "/api/connectors",
  "/api/http-tools",
  "/api/prompts",
  "/api/memories",
  "/api/design-systems",
  "/api/keys",
  "/api/usage",
  "/api/workspaces",
  "/api/shared-artifacts",
  "/api/tasks",
  "/api/search?q=x",
];

/**
 * Public on purpose: the catalog is OpenRouter's own public data and the models
 * page has to render before anyone signs in. Asserted rather than assumed — a
 * signed-out response must contain no `ext:` ids, which are a user's own
 * configured providers and would be a real leak.
 */
const PUBLIC_JSON = ["/api/models"];

/** Admin-only. Must refuse an anonymous caller for the same reason. */
const ADMIN = ["/api/admin", "/api/admin/audit"];

const results = [];
const rec = (name, ok, detail) => results.push({ name, ok, detail });

const get = async (path, init) => {
  try {
    const res = await fetch(BASE + path, { redirect: "manual", ...init });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch (e) {
    return { status: 0, body: String(e).slice(0, 120) };
  }
};

console.log(`Smoking ${BASE}\n`);

for (const [path, want] of PUBLIC) {
  const r = await get(path);
  rec(`GET ${path} → ${want}`, r.status === want, `got ${r.status}`);
}

for (const path of PRIVATE) {
  const r = await get(path);
  const refused = r.status === 401 || r.status === 403;
  rec(`GET ${path} refuses an anonymous caller`, refused, `got ${r.status}`);
}

for (const path of PUBLIC_JSON) {
  const r = await get(path);
  rec(`GET ${path} serves the public catalog`, r.status === 200, `got ${r.status}`);
  const body = await fetch(BASE + path).then((x) => x.text());
  rec(
    `GET ${path} leaks no private provider models`,
    !body.includes('"id":"ext:'),
    "an anonymous response contained an ext: id"
  );
}

for (const path of ADMIN) {
  const r = await get(path);
  const refused = r.status === 401 || r.status === 403;
  rec(`GET ${path} refuses a non-admin`, refused, `got ${r.status}`);
}

// Writes must refuse too — a POST that creates something without a session
// would be worse than a GET that reads.
for (const path of ["/api/conversations", "/api/agents", "/api/workspaces", "/api/skills"]) {
  const r = await get(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ name: "smoke-test-should-never-be-created" }),
  });
  const refused = r.status === 401 || r.status === 403;
  rec(`POST ${path} refuses an anonymous caller`, refused, `got ${r.status}`);
}

// The platform API authenticates with a key rather than a cookie, so it should
// reject a bad key rather than fall through to the cookie path.
{
  const r = await get("/v1/models", { headers: { Authorization: "Bearer lbd-not-a-real-key" } });
  rec("/v1/models rejects a bad platform key", r.status === 401 || r.status === 403, `got ${r.status}`);
}

// Cross-origin writes are blocked in middleware; prove it still is.
{
  const r = await get("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  rec(
    "cross-origin write is blocked",
    r.status === 403 || r.status === 401,
    `got ${r.status}`
  );
}

// The changelog must actually carry entries, not just return 200.
{
  const r = await get("/changelog.html");
  const entries = (r.body.match(/data-kind/g) ?? []).length;
  const full = await fetch(BASE + "/changelog.html").then((x) => x.text());
  rec(
    "changelog has entries",
    (full.match(/data-kind/g) ?? []).length >= 30,
    `${(full.match(/data-kind/g) ?? []).length} entries`
  );
  void entries;
}

// The landing page must link to it, or nobody finds it.
{
  const full = await fetch(BASE + "/").then((x) => x.text());
  rec("landing links to the changelog", full.includes("/changelog.html"), "");
}

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`  FAIL  ${r.name} — ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} live checks passing.`);
process.exit(failed.length ? 1 : 0);
