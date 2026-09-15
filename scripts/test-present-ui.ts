/**
 * Present mode, end to end in the real app.
 *
 * The unit tests prove the deck runtime works and the browser test proves it
 * renders. Neither proves the app WIRES it: that the sidebar has a Present tab,
 * that a present conversation reopens in Present on a cold load, that the
 * outline block becomes an editable card instead of raw JSON, and that the deck
 * opens in the panel with its theme pickers.
 *
 * It signs up, seeds a deck into that account, and drives the interface, so it
 * costs nothing and needs no model. Local server only — it creates accounts.
 *
 *   npx tsx scripts/test-present-ui.ts http://localhost:3777
 *
 * Needs playwright; skips cleanly (exit 0) when it is absent.
 */

import { execFileSync } from "node:child_process";

const BASE = process.argv[2] ?? "http://localhost:3777";

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the Present UI test.");
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  const bodyText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  /** A fresh account gets a welcome tour; dismiss anything covering the app. */
  const clearOverlays = async () => {
    for (let i = 0; i < 4; i++) {
      if ((await page.locator("div.fixed.inset-0").count()) === 0) return;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };
  console.log("Present mode (app):\n");

  // ------------------------------------------------------------- an account
  const email = `present-${Date.now()}@example.test`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const su = page.getByRole("button", { name: /sign up/i });
  if (await su.count()) await su.first().click();
  await page.getByPlaceholder("Your name").fill("Present Tester").catch(() => {});
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/^Password/).fill("correct horse battery staple");
  await page
    .getByRole("button", { name: /create account|sign up/i })
    .first()
    .click();
  await page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 })
    .catch(() => {});
  check("signed up", !page.url().includes("/login"));

  const userId = await page.evaluate(async () => {
    const r = await fetch("/api/auth");
    const j = await r.json();
    return j?.user?.id ?? "";
  });
  check("the session reports a user", Boolean(userId));

  // The welcome screens hide their templates until an API key exists. Nothing
  // here ever calls a model, so a syntactically valid placeholder is enough.
  await page.evaluate(async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-or-v1-" + "0".repeat(56) }),
    });
  });

  // Seed the deck straight into that account, so the UI has real content to
  // show without a model call.
  const seed = (args: string[]) => {
    const out = execFileSync("npx", ["tsx", "scripts/seed-deck.ts", userId, ...args], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return (
      JSON.parse(out.trim().split("\n").pop() || "{}") as { conversationId?: string }
    ).conversationId;
  };
  // Two conversations: one still at the outline step (so the editor is live)
  // and one with the deck already built (so the outline is history).
  const OUTLINE_CONV = seed(["--outline-only"]);
  const CONV = seed([]);
  check("seeded a present conversation", Boolean(CONV) && Boolean(OUTLINE_CONV));
  if (!CONV || !OUTLINE_CONV) {
    await browser.close();
    process.exit(1);
  }

  // --------------------------------------------------- the workspace switcher
  await page.goto(BASE, { waitUntil: "networkidle" });
  await clearOverlays();
  await page.waitForTimeout(1200);

  const presentTab = page.getByRole("button", { name: /^Present$/ }).first();
  check("the sidebar has a Present tab", (await presentTab.count()) > 0);
  if ((await presentTab.count()) === 0) {
    await browser.close();
    process.exit(1);
  }
  await presentTab.click();
  await page.waitForTimeout(1500);

  let text = await bodyText();
  check("the welcome offers all three ways in", /Generate/.test(text) && /Paste in text/.test(text) && /Import file/.test(text));
  check("templates cover more than decks", /Landing page/.test(text) && /Social carousel/.test(text) && /Report/.test(text));
  check("the new-conversation button says deck", /New deck/.test(text));

  // The setup chips are the generation settings, and they must be real controls.
  const formatChip = page.locator("select").filter({ hasText: /Presentation/ }).first();
  check("a format chip is present", (await formatChip.count()) > 0);
  if (await formatChip.count()) {
    await formatChip.selectOption("social");
    await page.waitForTimeout(400);
    const sizeChip = page.locator("select").filter({ hasText: /4:5|1:1|9:16/ }).first();
    check("changing format re-offers the right sizes", (await sizeChip.count()) > 0);
    await formatChip.selectOption("presentation");
    await page.waitForTimeout(300);
  }

  // ------------------------------------------------------------- the outline
  await page.goto(`${BASE}/c/${OUTLINE_CONV}`, { waitUntil: "networkidle" });
  await clearOverlays();
  await page.waitForTimeout(2500);
  text = await bodyText();

  check(
    "a present conversation reopens in Present on a cold load",
    await page
      .getByRole("button", { name: /^Present$/ })
      .first()
      .evaluate((el) => el.getAttribute("aria-pressed") === "true")
  );
  check(
    "no machine tags leak into the transcript",
    !/liberdeOutline|liberdeArtifact|data-layout/.test(text),
    text.match(/liberde\w+/)?.[0]
  );
  check("the outline renders as a card", /Northwind Analytics/.test(text));

  const cardTitles = page.locator('input[aria-label^="Card "][aria-label$=" title"]');
  check("every outline card is an editable field", (await cardTitles.count()) === 6, String(await cardTitles.count()));
  const layoutSelects = page.locator('select[aria-label^="Card "][aria-label$=" layout"]');
  check("every outline card exposes its layout", (await layoutSelects.count()) === 6);
  if (await cardTitles.count()) {
    await cardTitles.nth(1).fill("Dashboards answer nothing");
    await page.waitForTimeout(200);
    check(
      "outline titles are editable in place",
      (await cardTitles.nth(1).inputValue()) === "Dashboards answer nothing"
    );
    const before = await cardTitles.nth(0).inputValue();
    const moveDown = page.getByRole("button", { name: "Move down" }).first();
    if (await moveDown.count()) {
      await moveDown.click();
      await page.waitForTimeout(300);
      check("cards reorder", (await cardTitles.nth(1).inputValue()) === before);
    }
    const remove = page.getByRole("button", { name: "Remove card" }).last();
    if (await remove.count()) {
      await remove.click();
      await page.waitForTimeout(300);
      check("cards can be removed", (await cardTitles.count()) === 5, String(await cardTitles.count()));
    }
    const add = page.getByRole("button", { name: /Add card/ }).first();
    if (await add.count()) {
      await add.click();
      await page.waitForTimeout(300);
      check("cards can be added", (await cardTitles.count()) === 6);
    }
  }
  check(
    "the outline has a Generate button",
    (await page.getByRole("button", { name: /^Generate$/ }).count()) > 0
  );

  // ------------------------------------------------ a seeded deck conversation
  await page.goto(`${BASE}/c/${CONV}`, { waitUntil: "networkidle" });
  await clearOverlays();
  await page.waitForTimeout(2500);
  text = await bodyText();
  check(
    "a built deck leaves the outline as a read-only summary",
    /Northwind Analytics/.test(text) &&
      (await page.locator('input[aria-label^="Card "]').count()) === 0
  );

  // ---------------------------------------------------------------- the deck
  const deckChip = page.getByText("Northwind Analytics").last();
  const artifactButton = page.locator("button").filter({ hasText: /Northwind Analytics/ }).last();
  if (await artifactButton.count()) {
    await artifactButton.click();
  } else {
    await deckChip.click();
  }
  await page.waitForTimeout(2500);
  text = await bodyText();

  const frames = page.frames();
  const deckFrame = frames.find((f) => f.url().startsWith("about:") && f !== page.mainFrame());
  check("the deck opens in the artifact panel", Boolean(deckFrame));
  if (deckFrame) {
    const cards = await deckFrame.locator(".deck > .card").count();
    check("all six cards render in the panel", cards === 6, String(cards));
    check(
      "the stats card shows its numerals",
      (await deckFrame.locator(".stat > b").count()) === 3
    );
    check(
      "the timeline is drawn, not listed",
      (await deckFrame.locator('.card[data-layout="timeline"] .steps > li').count()) === 3
    );
    check(
      "placeholder art is painted in the theme",
      (await deckFrame.locator(".ld-ph").count()) === 2
    );
    check(
      "the theme reached the deck",
      (await deckFrame.locator("html").getAttribute("data-theme")) === "aurora"
    );
  }

  check("the panel offers Present", /Present/.test(text));
  check("the panel offers a notes view", /Notes view/.test(text));
  check("the panel offers PDF, PPTX and PNG export", /PDF/.test(text) && /PPTX/.test(text) && /PNG/.test(text));
  check("the per-card edit bar is there", /edit card/i.test(text));
  check("per-card AI actions are offered", /New layout/.test(text) && /Visualise/.test(text));

  // --------------------------------------------------------- the theme picker
  const themeBtn = page.getByRole("button", { name: "Deck theme" }).first();
  check("a theme picker is present", (await themeBtn.count()) > 0);
  if ((await themeBtn.count()) && deckFrame) {
    await themeBtn.click();
    await page.waitForTimeout(400);
    const neon = page.getByText("Neon", { exact: true }).first();
    check("the picker lists themes by name", (await neon.count()) > 0);
    if (await neon.count()) {
      await neon.hover();
      await page.waitForTimeout(800);
      check(
        "hovering a theme previews it live",
        (await deckFrame.locator("html").getAttribute("data-theme")) === "neon"
      );
      await neon.click();
      await page.waitForTimeout(3000);
      const after = await page
        .getByRole("button", { name: "Deck theme" })
        .first()
        .getAttribute("title");
      check("choosing a theme saves it", /Neon/.test(after ?? ""), after ?? "");
      // A saved theme swap must be a new version, not a silent overwrite.
      const versioned = await page.locator("body").innerText();
      check("the swap produced a new version", /v2|Version 2|2 \/ 2/.test(versioned.replace(/\s+/g, " ")));
    }
  }

  check("no page errors", errors.length === 0, errors[0]);

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
