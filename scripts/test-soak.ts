/**
 * A long, ordinary session — with the same invariants asserted after every
 * single turn.
 *
 * Written because the other suites are confirmatory: each was added alongside a
 * fix and checks that one fix, in the shape it was expected to take. That finds
 * nothing new, which is why this session went bug, fix, bug, fix. The failures
 * were all the same handful of shapes appearing in a path nobody had pointed a
 * browser at yet — a raw machine tag reaching the screen, a container collapsing
 * to nothing, a technical error string shown to a person, a loop stopping in
 * silence.
 *
 * So the checks here are not about features. They are properties that must hold
 * after anything the user does, and they run after every turn:
 *
 *   - no machine tag is ever visible
 *   - no raw error class or JSON is ever shown as a message
 *   - code that produced output is never labelled unrun
 *   - nothing that should hold content is zero-height
 *   - the page throws nothing
 *
 * Failures accumulate rather than stopping the run, so one bad turn does not
 * hide the six after it.
 *
 *   OPENROUTER_API_KEY=... npx tsx scripts/test-soak.ts http://localhost:3799
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3799";
const KEY = process.env.OPENROUTER_API_KEY ?? "";

/** Tags that exist for the machine and must never reach a reader. */
const MACHINE_TAGS = [
  "<liberdeArtifact",
  "</liberdeArtifact>",
  "<liberdeRun",
  "</liberdeRun>",
  "<liberdeRunResult>",
  "<liberdeAsk>",
  "<liberdeMemory>",
];

/** Strings that mean an implementation detail leaked into the interface. */
const LEAKED_INTERNALS = [
  "TypeError",
  "Load failed",
  "Failed to fetch",
  "[object Object]",
  "undefined is not",
  "NaN",
  "ReferenceError",
  "Cannot read properties",
];

async function main() {
  if (!KEY) {
    console.log("OPENROUTER_API_KEY is not set — skipping the soak.");
    process.exit(0);
  }
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the soak.");
    process.exit(0);
  }

  const failures: string[] = [];
  let checks = 0;
  const fail = (where: string, what: string, detail = "") => {
    failures.push(`[${where}] ${what}${detail ? " — " + detail : ""}`);
  };

  const csv = join(tmpdir(), `soak-${Date.now()}.csv`);
  writeFileSync(
    csv,
    "date,region,amount\n2026-01-05,north,1200.50\n2026-01-11,south,880\n" +
      "2026-02-03,north,2310.75\n2026-02-19,east,455.25\n2026-03-02,south,1990\n"
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));

  /** Everything that must be true no matter what the user just did. */
  const invariants = async (where: string) => {
    checks++;
    const body = await page.locator("body").innerText();

    for (const tag of MACHINE_TAGS) {
      if (body.includes(tag)) fail(where, `machine tag visible: ${tag}`);
    }
    for (const s of LEAKED_INTERNALS) {
      if (body.includes(s)) fail(where, `internal string shown to the user: ${s}`);
    }

    // Code that produced output must not be labelled unrun, and vice versa.
    if (/not run/.test(body) && /\bOutput\b/.test(body)) {
      fail(where, "a block is labelled 'not run' while an Output block exists");
    }

    // Anything holding a reply must have height. Collapsed containers are how
    // the comparison columns lost their answers.
    const collapsed = await page.evaluate(() => {
      const holders = [...document.querySelectorAll("div")].filter((d) =>
        /Use this reply|Use the verdict|click to open/.test(d.textContent ?? "")
      );
      return holders.filter((d) => {
        const r = d.getBoundingClientRect();
        return r.width > 40 && r.height > 0 && r.height < 24;
      }).length;
    });
    if (collapsed > 0) fail(where, `${collapsed} content container(s) collapsed to a sliver`);

    const before = pageErrors.length;
    void before;
    if (pageErrors.length) {
      fail(where, "uncaught page error", pageErrors.splice(0).join(" | "));
    }
  };



  /**
   * Run one step, and keep going if it throws.
   *
   * The header of this file says one bad turn must not hide the six after it —
   * which was true of assertions and not of exceptions. A click blocked by a
   * leftover modal aborted the whole session, so everything downstream went
   * unchecked and the run reported a stack trace instead of findings.
   */
  const step = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (e) {
      fail(name, "the step threw", String((e as Error).message).split("\n")[0].slice(0, 120));
    }
  };


  /**
   * Click something, and if it will not click, say what and why.
   *
   * A bare .click() that times out reports "locator.click: Timeout" and nothing
   * else — which locator, whether it existed, whether it was disabled, what was
   * on top of it. That sent me diagnosing the wrong element twice. A test that
   * cannot say what failed is only slightly better than no test.
   */
  const clickOrFail = async (
    label: string,
    locator: import("playwright").Locator,
    timeout = 15_000
  ): Promise<boolean> => {
    if ((await locator.count()) === 0) {
      checks++;
      fail(label, "control not present");
      return false;
    }
    try {
      await locator.click({ timeout });
      return true;
    } catch {
      const why = await locator
        .evaluate((el) => {
          const b = el as HTMLButtonElement;
          const r = b.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(cx, cy);
          return [
            b.disabled ? "disabled" : "enabled",
            `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)}`,
            r.height === 0 ? "zero-height" : "",
            top && !b.contains(top)
              ? `covered by ${top.tagName}.${String(top.className).slice(0, 40)}`
              : "",
          ]
            .filter(Boolean)
            .join("; ");
        })
        .catch(() => "could not inspect the element");
      checks++;
      fail(label, "would not click", why);
      return false;
    }
  };

  /** Close anything modal before clicking into the page underneath. */
  const clearOverlays = async () => {
    for (let i = 0; i < 3; i++) {
      const overlay = await page.locator("div.fixed.inset-0").count();
      if (overlay === 0) return;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  /** Assert the step actually did something, not merely that nothing broke. */
  const happened = async (where: string, needle: RegExp | string) => {
    checks++;
    const body = await page.locator("body").innerText();
    const ok = typeof needle === "string" ? body.includes(needle) : needle.test(body);
    if (!ok) fail(where, "the step must have happened, and did not", String(needle));
  };

  /** How many assistant replies are on screen, to prove a turn landed. */
  const replyCount = () =>
    page.evaluate(
      () => document.querySelectorAll("[data-role='assistant'], .prose").length
    );

  /** Send a message and wait for the turn to settle. */
  const say = async (label: string, text: string, waitMs: number) => {
    const before = await replyCount();
    const composer = page.locator("textarea").first();
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForTimeout(waitMs);
    checks++;
    if ((await replyCount()) <= before) {
      fail(label, "no reply arrived — the turn did not happen");
    }
  };

  // -------------------------------------------------------------- set up ---
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const su = page.getByRole("button", { name: /sign up/i });
  if (await su.count()) await su.first().click();
  await page.getByPlaceholder("Your name").fill("Soak").catch(() => {});
  await page.getByPlaceholder("Email").fill(`soak-${Date.now()}@example.test`);
  await page.getByPlaceholder(/^Password/).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account|sign up/i }).first().click();
  await page.waitForTimeout(6000);

  await page.evaluate(async (k) => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: k, defaultModel: "anthropic/claude-sonnet-5" }),
    });
  }, KEY);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  await invariants("fresh account");

  // ------------------------------------------------------------ the session -
  await say("plain reply", "In one sentence, what is a pelican?", 35_000);
  await happened("plain reply", /pelican/i);
  await invariants("plain reply");

  // An attachment, then analysis over it — the /data contract.
  const chooser = page.locator('input[type="file"]').first();
  if (await chooser.count()) {
    await chooser.setInputFiles(csv);
    await page.waitForTimeout(2500);
  }
  checks++;
  if ((await chooser.count()) === 0) fail("attachment", "no file input to attach with");
  await say(
    "python over an attachment",
    "Use the analysis tool with Python to read the attached CSV and print total amount by region.",
    130_000
  );
  // The code must have run and the totals must come from the file: north is
  // 1200.50 + 2310.75 = 3511.25, which cannot be guessed.
  await happened("python over an attachment", /Ran Python/);
  await happened("python over an attachment", /\bOutput\b/);
  await happened("python over an attachment", /3511|3,511/);
  await invariants("python over an attachment");

  await say("maths", "What is the compound interest formula? Show it.", 45_000);
  checks++;
  if ((await page.locator(".katex").count()) === 0) {
    fail("maths", "no formula was typeset — KaTeX rendered nothing");
  }
  await invariants("maths");

  await say(
    "artifact created",
    "Build an HTML artifact called Soak Page: a heading and two paragraphs, styled.",
    120_000
  );
  await happened("artifact created", /click to open/);
  checks++;
  {
    const titles = await page.evaluate(async () => {
      const r = await fetch("/api/artifacts");
      if (!r.ok) return [];
      const d = await r.json();
      return (Array.isArray(d) ? d : (d.artifacts ?? [])).map(
        (a: { title: string }) => a.title
      );
    });
    if (titles.length === 0) fail("artifact created", "no artifact was saved");
  }
  await invariants("artifact created");

  await say("artifact updated", "Change the heading colour to dark green.", 100_000);
  checks++;
  {
    // Gallery cards carry no versions; the per-conversation endpoint does.
    const versions = await page.evaluate(async () => {
      const convs = await (await fetch("/api/conversations")).json();
      const list = Array.isArray(convs) ? convs : (convs.conversations ?? []);
      const id = list[0]?.id;
      if (!id) return 0;
      const r = await fetch("/api/conversations/" + id + "/artifacts");
      if (!r.ok) return 0;
      const arts = await r.json();
      const items = Array.isArray(arts) ? arts : (arts.artifacts ?? []);
      return items.reduce(
        (n: number, a: { versions?: unknown[] }) => n + (a.versions?.length ?? 0),
        0
      );
    });
    if (versions < 2) fail("artifact updated", "the edit produced no second version");
  }
  await invariants("artifact updated");

  // Reload mid-conversation: the path that stranded the panel and the loop.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(8000);
  await happened("after a reload", /pelican/i);
  await invariants("after a reload");

  // Background and return: the path that dropped the stream.
  const other = await ctx.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.waitForTimeout(8000);
  await page.bringToFront();
  await page.waitForTimeout(6000);
  await happened("after a tab switch", /pelican/i);
  await invariants("after a tab switch");

  // Controls that have each broken at least once.
  const regen = page.locator("button[title='Regenerate with a different model']").first();
  if (await regen.count()) {
    await regen.click();
    await page.waitForTimeout(900);
    const fits = await page.evaluate(() => {
      const input = document.querySelector("input[placeholder='Regenerate with…']");
      const menu = input?.closest("div");
      if (!menu) return true;
      const r = menu.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    if (!fits) fail("regenerate menu", "opens off the edge of the window");
    checks++;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  await invariants("regenerate menu");

  // Every settings tab, which is where dead features hid.
  await clearOverlays();
  const gear = page.locator('[title*="Settings" i], button:has-text("Settings")').first();
  if (await gear.count()) {
    await gear.click();
    await page.waitForTimeout(1200);
    for (const tab of [
      "Agents",
      "Workspaces",
      "Audit log",
      "Skills",
      "Connectors",
      "Custom tools",
      "Prompts",
      "Design systems",
      "Providers",
      "Keys",
    ]) {
      const el = page.getByRole("button", { name: tab, exact: true }).first();
      if ((await el.count()) === 0) {
        fail("settings", `tab missing: ${tab}`);
        checks++;
        continue;
      }
      await el.click();
      await page.waitForTimeout(450);
      await invariants(`settings → ${tab}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // The other surfaces.

  await step("second opinion", async () => {
    await clearOverlays();
    const closePanel = page.locator('button[title="Close"]').first();
    if (await closePanel.count()) await closePanel.click().catch(() => {});
    await page.waitForTimeout(800);
    const second = page.getByRole("button", { name: /second opinion/i }).first();
    checks++;
    if ((await second.count()) === 0) {
      fail("second opinion", "no control on a finished reply");
    } else {
      if (!(await clickOrFail("second opinion → open", second))) return;
      await page.waitForTimeout(1500);
      const go = page.getByRole("button", { name: /^Compare$/ }).first();
      if (!(await clickOrFail("second opinion → Compare", go))) return;
      await page
        .waitForFunction(() => document.body.innerText.includes("Council verdict"), null, {
          timeout: 280_000,
        })
        .catch(() => {});
      await page.waitForTimeout(4000);

      await happened("second opinion", /Council verdict/);
      await happened("second opinion", /Use this reply/);

      // The verdict must lead, and the columns must be readable — both have
      // been wrong before.
      checks++;
      const geo = await page.evaluate(() => {
        // No named helpers in here: tsx compiles them with a __name wrapper that
        // does not exist in the page, and the whole evaluate throws
        // ReferenceError before any assertion runs.
        const buttons = [...document.querySelectorAll("button")];
        const verdict = buttons.find((e) =>
          (e.textContent ?? "").trim().startsWith("Use the verdict")
        );
        const col = buttons.find((e) =>
          (e.textContent ?? "").trim().startsWith("Use this reply")
        );
        const card = col?.closest("div.flex.flex-col");
        return {
          verdictTop: verdict ? Math.round(verdict.getBoundingClientRect().top) : null,
          colTop: col ? Math.round(col.getBoundingClientRect().top) : null,
          colHeight: card ? Math.round(card.getBoundingClientRect().height) : 0,
        };
      });
      if (geo.verdictTop === null) fail("second opinion", "no verdict rendered");
      else if (geo.colTop !== null && geo.verdictTop > geo.colTop) {
        fail("second opinion", "the verdict sits below the columns");
      }
      if (geo.colHeight > 0 && geo.colHeight < 80) {
        fail("second opinion", `a column collapsed to ${geo.colHeight}px`);
      }
      await invariants("second opinion");
    }
  });

  // Whatever happened above, the comparison panel must not be left over the app.
  await clearOverlays();
  await page.waitForTimeout(600);

  await step("design", async () => {
    await clearOverlays();
    const design = page.getByRole("button", { name: /^Design$/ }).first();
    checks++;
    if ((await design.count()) === 0) fail("design", "no Design workspace tab");
    else {
      if (!(await clickOrFail("design → open", design))) return;
      await page.waitForTimeout(2500);
      await happened("design", /Design|canvas|Pick a starting point/i);
      await invariants("design workspace");
      const chat = page.getByRole("button", { name: /^Chat$/ }).first();
      if (await chat.count()) await chat.click();
      await page.waitForTimeout(1500);
    }
  });

  await step("plan mode", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const plan = page.getByRole("button", { name: /^Plan$/ }).first();
    checks++;
    if ((await plan.count()) === 0) fail("plan mode", "no Plan control on the composer");
    else {
      if (!(await clickOrFail("plan mode → toggle", plan))) return;
      await page.waitForTimeout(600);
      await say("plan mode", "Plan how to rename a variable across three files.", 150_000);
      await happened("plan mode", /step|plan/i);
      await invariants("plan mode");
    }
  });

  await step("gallery", async () => {
    await page.goto(BASE + "/artifacts", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await happened("gallery", /Soak Page|Yours|Shared/i);
    checks++;
    const card = page.locator("text=Soak Page").first();
    if ((await card.count()) === 0) fail("gallery", "the artifact just built is not listed");
    await invariants("gallery");
  });

  await step("create a prompt", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const gear2 = page.locator('[title*="Settings" i], button:has-text("Settings")').first();
    if (await gear2.count()) {
      await gear2.click();
      await page.waitForTimeout(1200);
      const tab = page.getByRole("button", { name: "Prompts", exact: true }).first();
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(600);
        const name = page.getByPlaceholder(/Name \(e\.g\./).first();
        const body = page.getByPlaceholder(/Prompt text/).first();
        if ((await name.count()) && (await body.count())) {
          await name.fill("Soak Prompt");
          await body.fill("Summarise the following in three bullets.");
          const save = page.getByRole("button", { name: /save prompt/i }).first();
          if (await save.count()) await save.click();
          await page.waitForTimeout(1500);
          await happened("create a prompt", /soak-prompt|Soak Prompt/i);
        } else {
          checks++;
          fail("create a prompt", "the form fields were not found");
        }
        await invariants("create a prompt");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
  });

  const PAGE_PROOF: [string, RegExp][] = [
    ["/artifacts", /Soak Page|artifact/i],
    ["/models", /context|Chat →|Set default/i],
    ["/usage", /usage|spend|cost|tokens/i],
    ["/help", /Getting started|Run code|Agents/i],
  ];
  for (const [path, proof] of PAGE_PROOF) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await happened(`page ${path}`, proof);
    await invariants(`page ${path}`);
  }

  // And the whole thing again at phone width, where layout breaks live.
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(BASE, { waitUntil: "networkidle" });
  await phone.waitForTimeout(3000);
  {
    checks++;
    const body = await phone.locator("body").innerText();
    for (const tag of MACHINE_TAGS) {
      if (body.includes(tag)) fail("phone", `machine tag visible: ${tag}`);
    }
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    );
    if (overflow) fail("phone", "the page scrolls sideways");
  }

  await browser.close();
  try {
    unlinkSync(csv);
  } catch {
    /* already gone */
  }

  console.log(`\n${checks} invariant sweeps across one session`);
  if (failures.length === 0) {
    console.log("no violations");
  } else {
    console.log(`\n${failures.length} violation(s):`);
    for (const f of failures) console.log("  " + f);
    process.exit(1);
  }
}

main();
