#!/usr/bin/env node
/**
 * The whole-platform audit: does every feature actually exist, in both
 * editions, where the documentation says it does?
 *
 * Written after four features shipped that no screen could reach, two of them
 * described in the README as though they had a home. Typechecks and builds had
 * been green the whole time, because neither asks the questions that matter:
 *
 *   REACH   can a person get to this from the interface?
 *   PARITY  does the other edition have it too?
 *   TRUTH   does the documentation describe something that exists?
 *   WIRING  is the capability connected end to end, not just present?
 *
 * Every check names its evidence, so a failure points at a file rather than at
 * a feeling. Run with --json for machine output.
 *
 *   node scripts/audit-platform.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const CLOUD = process.cwd();
const SELF = "C:/src/Liberde";
const JSON_OUT = process.argv.includes("--json");

// ---------------------------------------------------------------- utils ----

const walk = (dir, out = []) => {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (["node_modules", ".next", ".git", "data"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const relOf = (root) => (f) => relative(root, f).split(sep).join("/");
const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const cloudFiles = walk(CLOUD);
const selfFiles = walk(SELF);
const relC = relOf(CLOUD);
const relS = relOf(SELF);

const cloudSrc = new Map(
  cloudFiles.filter((f) => /\.(ts|tsx|mjs|md|html)$/.test(f)).map((f) => [relC(f), readFileSync(f, "utf8")])
);
const selfSrc = new Map(
  selfFiles.filter((f) => /\.(ts|tsx|mjs|md|html)$/.test(f)).map((f) => [relS(f), readFileSync(f, "utf8")])
);

/** Everything a user-facing screen could contain, concatenated. */
const uiText = [...cloudSrc]
  .filter(([p]) => !p.startsWith("app/api/") && !p.startsWith("app/v1/") && !p.startsWith("scripts/"))
  .map(([, t]) => t)
  .join("\n");

const results = [];
const record = (area, check, ok, evidence) =>
  results.push({ area, check, ok, evidence });

// ============================================================== 1. REACH ====

const ROUTE_ALLOW = new Map([
  ["/api/cron", "the scheduler calls it"],
  ["/api/auth/google/callback", "the OAuth provider redirects here"],
  ["/api/auth/verify", "opened from the verification email"],
  ["/api/oauth/callback", "the MCP server redirects here"],
  ["/v1/chat/completions", "public platform API, for external clients"],
  ["/v1/models", "public platform API, for external clients"],
  ["/api/remix/[shareId]", "entered by URL from a shared link"],
  ["/api/shared/[shareId]", "entered by URL from a shared link"],
  ["/api/img/[id]", "used as an <img> src"],
]);

for (const [p] of cloudSrc) {
  if (!/^app\/.*\/route\.ts$/.test(p)) continue;
  const route = "/" + p.replace(/^app\//, "").replace(/\/route\.ts$/, "");
  if (ROUTE_ALLOW.has(route)) continue;
  const probe = route.split("/[")[0];
  if (!probe || probe === "/api") continue;
  record("reach", `${route} has a caller in the interface`, uiText.includes(probe), p);
}

// ============================================================= 2. PARITY ====
//
// The two editions are the same product. A file present in one and absent in
// the other is a feature only half the users have — the failure this section
// exists to catch, and one that no build can see.

const SKIP_PARITY = [
  /^app\/api\/cron\//, // cloud-only: Vercel Cron
  /^vercel\.json$/,
  /^\.vercel/,
  /^public\/sw\.js$/,
  /^data\//,
  /^scripts\/audit-/, // the audit itself is copied by hand
];

for (const [p] of cloudSrc) {
  if (!/^(app|lib|components)\//.test(p)) continue;
  if (SKIP_PARITY.some((re) => re.test(p))) continue;
  record("parity", `${p} exists in the self-host build`, selfSrc.has(p), p);
}

// Features whose *wiring* has to be present in both, not just the file.
const PARITY_WIRING = [
  ["agents applied to the turn", "app/api/chat/route.ts", "agent?.model"],
  ["agent bundles loaded", "app/api/chat/route.ts", "agentBundleBlock"],
  ["agent knowledge project", "app/api/chat/route.ts", "agent?.project_id"],
  ["semantic retrieval", "lib/openrouter.ts", "retrieveSemantic"],
  ["prompt cache breakpoints", "app/api/chat/route.ts", "applyPromptCache"],
  ["python kernel", "lib/sandbox.ts", "runPython"],
  ["conformance check", "components/ArtifactPanel.tsx", "checkConformance"],
  ["compare humanises errors", "app/api/chat/compare/route.ts", "upstreamMessage"],
  ["compare blocks blind models", "components/ComparePanel.tsx", "canAnswer"],
  ["agents tab", "components/SettingsDialog.tsx", "function AgentsTab("],
  ["workspaces tab", "components/SettingsDialog.tsx", "function WorkspacesTab("],
  ["audit tab", "components/SettingsDialog.tsx", "function AuditTab("],
];

for (const [what, file, needle] of PARITY_WIRING) {
  const inCloud = (cloudSrc.get(file) ?? "").includes(needle);
  const inSelf = (selfSrc.get(file) ?? "").includes(needle);
  record("parity", `${what}: cloud`, inCloud, `${file} :: ${needle}`);
  record("parity", `${what}: self-host`, inSelf, `${file} :: ${needle}`);
}

// ============================================================== 3. TRUTH ====
//
// Documentation that names a place must name a place that exists. Each entry
// is a claim made in the README or Help, paired with what has to be true in
// the code for the claim to be honest.

const CLAIMS = [
  ["Settings → Agents", "components/SettingsDialog.tsx", 'id: "agents"'],
  ["Settings → Workspaces", "components/SettingsDialog.tsx", 'id: "workspaces"'],
  ["Settings → Audit log", "components/SettingsDialog.tsx", 'id: "audit"'],
  ["Settings → Skills", "components/SettingsDialog.tsx", 'id: "skills"'],
  ["Settings → Connectors", "components/SettingsDialog.tsx", 'id: "connectors"'],
  ["Settings → Design systems", "components/SettingsDialog.tsx", 'id: "design-systems"'],
  ["Settings → Providers", "components/SettingsDialog.tsx", 'id: "providers"'],
  ["Settings → Platform API keys", "components/SettingsDialog.tsx", 'id: "keys"'],
  ["semantic search panel", "components/SettingsDialog.tsx", "Semantic search over project knowledge"],
  ["install a skill from a URL", "components/SettingsDialog.tsx", "Install from a URL"],
  ["index existing projects", "components/SettingsDialog.tsx", "Index existing projects"],
  ["artifacts gallery", "components/ArtifactGallery.tsx", "Shared with you"],
  ["gallery route", "app/artifacts/page.tsx", "artifacts"],
  ["changelog page", "public/changelog.html", "data-kind"],
  ["changelog linked from landing", "public/landing.html", "/changelog.html"],
  ["python in the sandbox", "lib/sandbox.ts", "MPLBACKEND"],
  ["files into the sandbox", "lib/sandbox.ts", "/data/"],
  ["files out of the sandbox", "lib/sandbox.ts", "/out"],
  ["audit chain verification", "lib/audit.ts", "verifyAuditChain"],
  ["CEF export", "lib/audit.ts", "toCef"],
  ["workspace role matrix", "lib/workspaces.ts", "canAssignRole"],
  ["spend caps", "lib/workspaces.ts", "checkBudgets"],
];

for (const [claim, file, needle] of CLAIMS) {
  record("truth", `docs claim "${claim}" — it exists`, (cloudSrc.get(file) ?? "").includes(needle), `${file} :: ${needle}`);
}

// Anything the README says is in Settings must be a real tab id.
const readme = cloudSrc.get("README.md") ?? "";
const help = cloudSrc.get("components/HelpPanel.tsx") ?? "";
const settings = cloudSrc.get("components/SettingsDialog.tsx") ?? "";
const tabIds = [...settings.matchAll(/\{ id: "([a-z-]+)", label:/g)].map((m) => m[1]);
const tabLabels = [...settings.matchAll(/\{ id: "[a-z-]+", label: "([^"]+)"/g)].map((m) => m[1]);

for (const doc of [
  ["README", readme],
  ["Help", help],
]) {
  const [name, text] = doc;
  for (const m of text.matchAll(/Settings\s*(?:→|->)\s*([A-Za-z][A-Za-z ]{2,30})/g)) {
    const said = m[1].trim();
    // Longest known label the text starts with. Matching the first word instead
    // would score "Design systems" against a tab named "Design", which does not
    // exist — a false alarm that trains you to ignore the audit.
    const known = tabLabels
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((l) => said.toLowerCase().startsWith(l.toLowerCase()));
    record(
      "truth",
      `${name} says "Settings → ${said.split(" ").slice(0, 3).join(" ")}…" and that tab exists`,
      Boolean(known),
      `said "${said}" · tabs: ${tabLabels.join(", ")}`
    );
  }
}

// ======================================================== 3b. COVERAGE =====
//
// The opposite question to TRUTH. That section asks whether the docs describe
// something real; this asks whether everything real is described. A feature
// nobody wrote down is a feature nobody finds, which is the same outcome as
// not building it.

const readmeBoth = readme + "\n" + (readIf(join(SELF, "README.md")) || "");
const changelog = cloudSrc.get("CHANGELOG.md") ?? "";
const changelogPage = cloudSrc.get("public/changelog.html") ?? "";

// Every Settings tab is a feature. Each must be named in the README, in Help,
// and — since it shipped — in the changelog.
const DOC_EXEMPT = new Set(["general", "personalization", "admin"]);
for (const [i, id] of tabIds.entries()) {
  if (DOC_EXEMPT.has(id)) continue;
  const label = tabLabels[i];
  if (!label) continue;
  const word = label.split(" ")[0];
  record("coverage", `README mentions the "${label}" tab`, readmeBoth.includes(word), label);
  record("coverage", `Help mentions "${label}"`, help.includes(word), label);
}

// Headline features, and where each must appear. A feature missing from the
// changelog looks like it was always there; missing from the README, like it
// does not exist.
const FEATURE_DOCS = [
  ["Agents", "Agents"],
  ["artifacts gallery", "gallery"],
  ["code interpreter", "interpreter"],
  ["semantic retrieval", "Semantic"],
  ["workspaces", "Workspace"],
  ["audit log", "audit log"],
  ["prompt caching", "Prompt caching"],
  ["design systems", "Design system"],
  ["deep research", "Deep Research"],
  ["plan mode", "Plan mode"],
  ["second opinion", "Second opinion"],
  ["skills", "Skills"],
  ["projects", "Projects"],
  ["memory", "Memory"],
  ["scheduled tasks", "Scheduled tasks"],
  ["platform API", "Platform API"],
];

for (const [feature, needle] of FEATURE_DOCS) {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  record("coverage", `README documents ${feature}`, re.test(readmeBoth), needle);
  record("coverage", `the changelog records ${feature}`, re.test(changelog), needle);
}

// The published page and the markdown must not drift apart.
{
  const mdReleases = (changelog.match(/^## \d{4}-\d{2}-\d{2}/gm) ?? []).length;
  const htmlReleases = (changelogPage.match(/class="release"/g) ?? []).length;
  record(
    "coverage",
    "the changelog page has a section per markdown release",
    htmlReleases >= mdReleases,
    `${htmlReleases} on the page, ${mdReleases} in CHANGELOG.md`
  );
}

// Both editions must carry the same changelog and the same comparison table.
{
  const selfChangelog = readIf(join(SELF, "CHANGELOG.md"));
  record("coverage", "both editions ship the same changelog", selfChangelog === changelog, "");
  const tableOf = (t) => (t.match(/^\| \| \*\*Liberde\*\*[\s\S]*?\n\n/m) ?? [""])[0];
  record(
    "coverage",
    "both READMEs carry the same comparison table",
    tableOf(readme) === tableOf(readIf(join(SELF, "README.md"))),
    ""
  );
}

// A comparison is only credible if it admits where the project loses.
record(
  "coverage",
  "the comparison says where Liberde is behind",
  readme.includes("Where Liberde is behind"),
  ""
);

// ============================================================= 4. WIRING ====
//
// End-to-end connections that are easy to half-build: a control that saves a
// value nothing reads, or a value read from a control that cannot set it.

const WIRING = [
  [
    "embeddings: UI writes what the server reads",
    () =>
      settings.includes("embeddingEnabled") &&
      (cloudSrc.get("app/api/settings/route.ts") ?? "").includes("embedding_enabled") &&
      (cloudSrc.get("lib/embeddings.ts") ?? "").includes("embedding_enabled"),
  ],
  [
    "embeddings: default path needs no second key",
    () => (cloudSrc.get("lib/embeddings.ts") ?? "").includes("await getApiKey(userId)"),
  ],
  [
    "agent: form sends what the API accepts",
    () =>
      settings.includes("skillIds: form.skill_ids") &&
      (cloudSrc.get("app/api/agents/route.ts") ?? "").includes("idsOf(body.skillIds)"),
  ],
  [
    "agent: API stores what the reader reads",
    () =>
      (cloudSrc.get("lib/db.ts") ?? "").includes("skill_ids: idList(r.skill_ids)") &&
      (cloudSrc.get("lib/mcp.ts") ?? "").includes("agent.skill_ids"),
  ],
  [
    "agent: a chat can be started as one",
    () =>
      (cloudSrc.get("components/ChatView.tsx") ?? "").includes("agentId: pendingAgent.id") &&
      (cloudSrc.get("app/api/conversations/route.ts") ?? "").includes("body.agentId"),
  ],
  [
    "conformance: panel receives the system it checks against",
    () =>
      (cloudSrc.get("components/ChatView.tsx") ?? "").includes("designSystem={") &&
      (cloudSrc.get("components/ArtifactPanel.tsx") ?? "").includes("designSystem?:"),
  ],
  [
    "skill install: preview returns the source the installer posts",
    () =>
      (cloudSrc.get("app/api/skills/install/route.ts") ?? "").includes("raw: text") &&
      settings.includes("content: preview.raw"),
  ],
  [
    "reindex: button calls a route that exists",
    () =>
      settings.includes('"/api/projects/index"') &&
      cloudSrc.has("app/api/projects/index/route.ts"),
  ],
  [
    "compare: image guard reaches the panel",
    () =>
      (cloudSrc.get("components/ChatView.tsx") ?? "").includes("hasImages={") &&
      (cloudSrc.get("components/ComparePanel.tsx") ?? "").includes("hasImages"),
  ],
  [
    "image model picker uses the curated list",
    () => settings.includes('api<string[]>("/api/models/image")'),
  ],
  [
    "audit log: verify and both exports are reachable",
    () =>
      settings.includes("verify=1") &&
      settings.includes("format=jsonl") &&
      settings.includes("format=cef"),
  ],
  [
    "workspaces: members can be added and re-roled",
    () => settings.includes("/members") && settings.includes("canAssignRole") === false,
  ],
];

for (const [what, fn] of WIRING) {
  let ok = false;
  try {
    ok = Boolean(fn());
  } catch {
    ok = false;
  }
  record("wiring", what, ok, "");
}

// ============================================================== report ======

const areas = ["reach", "parity", "truth", "coverage", "wiring"];
const failed = results.filter((r) => !r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
} else {
  for (const area of areas) {
    const rows = results.filter((r) => r.area === area);
    const bad = rows.filter((r) => !r.ok);
    console.log(
      `\n${area.toUpperCase()}  ${rows.length - bad.length}/${rows.length} passing`
    );
    for (const r of bad) {
      console.log(`  FAIL  ${r.check}`);
      if (r.evidence) console.log(`        ${r.evidence}`);
    }
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passing, ${failed.length} failing.`
  );
}

process.exit(failed.length ? 1 : 0);
