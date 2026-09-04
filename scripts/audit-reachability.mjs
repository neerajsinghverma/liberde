#!/usr/bin/env node
/**
 * Find capability that exists but that nothing in the interface can reach.
 *
 * This exists because the same mistake happened four times in a row: an API
 * route, its database access and its tests all landed, and no screen ever
 * called it. Everything typechecked, everything built, and the feature was
 * invisible. A build passing is not evidence that a person can get to the
 * thing — this is the check that asks that question directly.
 *
 * Two sweeps:
 *
 *   routes   every app/api/** route, and whether any client component fetches
 *            its path. A route reachable only from another server file is
 *            reported too, because a user cannot click one of those either.
 *   exports  every exported symbol in lib/, and whether anything imports it.
 *
 * Neither sweep is proof: a path can be built at runtime from a variable, and
 * some exports are legitimately only for tests. So findings are printed for a
 * person to judge, and only the allowlist below silences one — with a reason,
 * so a silenced finding stays arguable rather than forgotten.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

/** Endpoints with no UI caller on purpose. Each needs a reason. */
const ROUTE_ALLOW = new Map([
  ["/api/cron", "invoked by the scheduler, not by a person"],
  ["/api/auth/google/callback", "the OAuth provider redirects here"],
  ["/api/oauth/callback", "the MCP server redirects here"],
  ["/api/auth/verify", "opened from the verification email, not from a screen"],
  ["/v1/chat/completions", "the public platform API — external clients call it"],
  ["/v1/models", "the public platform API — external clients call it"],
  ["/api/remix/[shareId]", "entered by URL from a shared link"],
  ["/api/shared/[shareId]", "entered by URL from a shared link"],
  ["/api/img/[id]", "referenced as an <img> src, not fetched"],
]);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const files = walk(ROOT);
const rel = (f) => relative(ROOT, f).split(sep).join("/");

const clientFiles = files.filter(
  (f) =>
    /\.(tsx|ts)$/.test(f) &&
    !rel(f).startsWith("app/api/") &&
    !rel(f).startsWith("app/v1/") &&
    !rel(f).startsWith("scripts/")
);
const clientText = clientFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// ------------------------------------------------------------- routes ----

const routeFiles = files.filter((f) => /^app\/.*\/route\.ts$/.test(rel(f)));
const unreachable = [];

for (const f of routeFiles) {
  const path =
    "/" +
    rel(f)
      .replace(/^app\//, "")
      .replace(/\/route\.ts$/, "");
  if (ROUTE_ALLOW.has(path)) continue;

  // A dynamic segment can only be matched by its static prefix.
  const probe = path.split("/[")[0];
  if (!probe || probe === "/api") continue;

  if (!clientText.includes(probe)) {
    const methods = [...readFileSync(f, "utf8").matchAll(/export async function (\w+)/g)]
      .map((m) => m[1])
      .filter((m) => ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(m));
    unreachable.push({ path, file: rel(f), methods });
  }
}

// ------------------------------------------------------------ exports ----

const libFiles = files.filter((f) => /^lib\/.*\.ts$/.test(rel(f)));
const sources = files
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !rel(f).startsWith("scripts/"))
  .map((f) => [rel(f), readFileSync(f, "utf8")]);

// A symbol is orphaned when NO file other than the one declaring it mentions
// it. Counting occurrences instead flags every helper a module uses internally,
// which is a tidiness question rather than a reachability one.
const orphanExports = [];
for (const f of libFiles) {
  const own = rel(f);
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(
    /^export (?:async )?function (\w+)|^export const (\w+)\s*[:=]/gm
  )) {
    const name = m[1] ?? m[2];
    if (!name) continue;
    const word = new RegExp("\\b" + name + "\\b");
    const usedElsewhere = sources.some(([path, text]) => path !== own && word.test(text));
    if (!usedElsewhere) orphanExports.push({ name, file: own });
  }
}

// ------------------------------------------------------------- report ----

let bad = 0;

if (routeFiles.length === 0) {
  console.error("\nAudit is broken: it checked no routes at all.");
  process.exit(2);
}

if (unreachable.length) {
  bad += unreachable.length;
  console.log("\nAPI routes no screen calls:\n");
  for (const r of unreachable) {
    console.log(`  ${r.path}  [${r.methods.join(", ")}]`);
    console.log(`    ${r.file}`);
  }
} else {
  console.log("\nAPI routes: every route has a caller in the interface.");
}

if (orphanExports.length) {
  console.log("\nlib exports nothing imports:\n");
  for (const o of orphanExports) console.log(`  ${o.name}  (${o.file})`);
} else {
  console.log("lib exports: all imported somewhere.");
}

console.log(
  `\n${routeFiles.length} routes checked, ${ROUTE_ALLOW.size} allowlisted, ${unreachable.length} unreachable.`
);

process.exit(bad > 0 ? 1 : 0);
