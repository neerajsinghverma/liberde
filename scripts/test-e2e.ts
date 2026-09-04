/**
 * Drive the real application in a real browser, as a real user.
 *
 * The audit proves a route has a caller and the logic tests prove a function is
 * right. Neither clicks anything. This signs up, creates an agent, starts a chat
 * as it, and opens every settings tab — the path a person actually takes, which
 * is the only one that catches a control that renders but does nothing.
 *
 * Runs against a locally started self-host build, never production: it creates
 * accounts and data, and doing that to a live service to satisfy a test would
 * be indefensible.
 *
 *   REQUIRE_AUTH=1 LIBERDE_SECRET_KEY=<hex> PORT=3777 npm start   # in the self-host repo
 *   npx tsx scripts/test-e2e.ts http://localhost:3777
 */

const BASE = process.argv[2] ?? "http://localhost:3777";

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the end-to-end test.");
    process.exit(0);
  }

  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) {
      passed++;
      console.log(`  ok    ${name}`);
    } else {
      failures.push(`${name}${detail ? " — " + detail : ""}`);
      console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    }
  };

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));

  // ------------------------------------------------------------ sign up ----
  // A unique address each run, so the suite is repeatable against one database.
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  const signupLink = page.getByRole("button", { name: /sign up/i });
  if (await signupLink.count()) await signupLink.first().click();

  await page.getByPlaceholder("Your name").fill("E2E Tester").catch(() => {});
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/^Password/).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account|sign up/i }).first().click();

  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {});
  check("a new account signs in and lands in the app", !page.url().includes("/login"), page.url());

  // A brand-new account lands on the welcome tour. Dismiss it the way a person
  // would, and assert that Escape works — it did not until this test found it.
  const tour = page.getByText("Welcome to Liberde", { exact: false });
  const sawTour = (await tour.count()) > 0;
  if (sawTour) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  check(
    "Skip the welcome tour: Escape dismisses it",
    !sawTour || (await page.getByText("Welcome to Liberde", { exact: false }).count()) === 0
  );

  // The composer is the app's front door; if it is absent nothing else matters.
  const composer = page.getByPlaceholder(/message|ask/i).first();
  await composer.waitFor({ timeout: 20_000 }).catch(() => {});
  check("the chat composer renders", await composer.count().then((n) => n > 0));

  // ------------------------------------------------------- settings tabs ---
  // Escape anything already open first. The command palette is a full-screen
  // overlay, and a click aimed past it is swallowed rather than failing loudly —
  // which is how the first version of this test hung instead of reporting.
  const settled = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  };

  await settled();
  const gear = page.locator('[title*="Settings" i], button:has-text("Settings")').first();
  if (await gear.count()) {
    await gear.click();
    await page.waitForTimeout(1200);
  }
  const settingsOpen = (await page.getByText("Design systems", { exact: false }).count()) > 0;
  check("Settings opens", settingsOpen);

  if (settingsOpen) {
    // Every tab must render without throwing. A tab that blanks is exactly the
    // kind of half-built control this whole exercise is about.
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
      const before = pageErrors.length;
      const el = page.getByRole("button", { name: tab, exact: true }).first();
      const found = (await el.count()) > 0;
      if (found) {
        await el.click();
        await page.waitForTimeout(500);
      }
      const body = await page.locator("body").innerText();
      check(
        `Settings → ${tab} opens and renders`,
        found && pageErrors.length === before && body.length > 200,
        found ? pageErrors.slice(before).join("; ") : "tab not found"
      );
    }

    // ------------------------------------------------------ create an agent -
    await page.getByRole("button", { name: "Agents", exact: true }).first().click();
    await page.waitForTimeout(400);
    const newAgent = page.getByRole("button", { name: /new agent/i }).first();
    check("Agents offers a way to create one", (await newAgent.count()) > 0);

    if (await newAgent.count()) {
      await newAgent.click();
      await page.waitForTimeout(400);
      await page.getByPlaceholder("Release notes writer").fill("E2E Agent");
      await page
        .getByPlaceholder("Turns a diff into notes our users can read")
        .fill("Created by the end-to-end test");
      // Scope to the field, not to "the first textarea on the page" — that is the
      // chat composer sitting disabled behind the dialog.
      const instructions = page.getByPlaceholder(/You write release notes/).first();
      if (await instructions.count()) await instructions.fill("Always answer in one sentence.");
      await page.getByRole("button", { name: /create agent/i }).first().click();
      await page.waitForTimeout(1200);

      const listed = (await page.getByText("E2E Agent", { exact: false }).count()) > 0;
      check("the agent is created and appears in the list", listed);

      // And the API agrees with the screen.
      const viaApi = await page.evaluate(async () => {
        const r = await fetch("/api/agents");
        return r.ok ? ((await r.json()) as { name: string }[]).map((a) => a.name) : [];
      });
      check("the agent persisted to the database", viaApi.includes("E2E Agent"), viaApi.join(", "));
    }

    // Close settings.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // ------------------------------------------- the agent reaches the chat ---
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Skip has to mean skip. The tour shows while no API key is set, which stays
  // true, so without persistence it returned on every navigation.
  check(
    "the tour stays dismissed after a reload",
    (await page.getByText("Welcome to Liberde", { exact: false }).count()) === 0
  );

  const chip = page.getByRole("button", { name: /E2E Agent/ }).first();
  const chipThere = (await chip.count()) > 0;
  check("the agent appears as a chip on a new chat", chipThere);

  if (chipThere) {
    await chip.click();
    await page.waitForTimeout(600);
    const header = await page.locator("body").innerText();
    check("selecting it shows which agent is answering", header.includes("E2E Agent"));
  }

  // ------------------------------------------------------- other surfaces --
  for (const [path, needle] of [
    ["/artifacts", /artifact/i],
    ["/models", /context|pricing|model/i],
    ["/usage", /usage|spend|cost/i],
    ["/help", /getting started|help/i],
  ] as [string, RegExp][]) {
    const before = pageErrors.length;
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const text = await page.locator("body").innerText();
    check(
      `${path} renders`,
      needle.test(text) && pageErrors.length === before,
      pageErrors.slice(before).join("; ") || text.slice(0, 80)
    );
  }

  check("no uncaught page errors anywhere in the walk", pageErrors.length === 0, pageErrors.join(" | "));

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} end-to-end checks passing`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  " + f);
    process.exit(1);
  }
}

main();
