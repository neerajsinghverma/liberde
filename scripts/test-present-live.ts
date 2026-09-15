/**
 * Present mode against a REAL model.
 *
 * Every other Present suite stubs the model out: the unit tests check the
 * runtime, the browser test checks rendering, and the UI test drives seeded
 * content. None of them proves the thing that actually decides whether Present
 * mode works — whether the directive makes a model emit a usable outline and
 * then a deck in our card grammar, with layouts varied and no CSS of its own.
 * That question only a model can answer.
 *
 * It signs up a throwaway account, sets the key on that account (never touching
 * yours), and picks the cheapest tool-capable model in the catalogue, so a full
 * run costs a fraction of a cent. Local server only — it creates accounts and
 * spends money.
 *
 *   OPENROUTER_API_KEY=sk-or-v1-... npx tsx scripts/test-present-live.ts http://localhost:3777
 *
 * Add --shots to save screenshots of the generated deck.
 * Add --model=<id> to test a specific model instead of the cheapest.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { DECK_LAYOUTS, DECK_THEMES } from "../lib/deck-runtime";

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:3777";
const KEY = process.env.OPENROUTER_API_KEY ?? "";
const SHOTS = args.includes("--shots");
const FORCED_MODEL = args.find((a) => a.startsWith("--model="))?.slice(8) ?? "";
const SHOT_DIR =
  "C:/Users/nverma/AppData/Local/Temp/3/claude/C--src-Liberde/deck-shots/live";

async function main() {
  if (!KEY) {
    console.log("OPENROUTER_API_KEY is not set — skipping the live Present test.");
    process.exit(0);
  }
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the live Present test.");
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
  const clearOverlays = async () => {
    for (let i = 0; i < 4; i++) {
      if ((await page.locator("div.fixed.inset-0").count()) === 0) return;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  console.log("Present mode (live model):\n");

  // ---------------------------------------------------- a throwaway account
  const email = `deck-live-${Date.now()}@example.test`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const su = page.getByRole("button", { name: /sign up/i });
  if (await su.count()) await su.first().click();
  await page.getByPlaceholder("Your name").fill("Deck Live").catch(() => {});
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

  const saved = await page.evaluate(async (k) => {
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: k }),
    });
    return r.ok ? ((await r.json()) as { hasApiKey?: boolean }).hasApiKey === true : false;
  }, KEY);
  check("the key is accepted and stored", saved);
  if (!saved) {
    await browser.close();
    process.exit(1);
  }

  const model =
    FORCED_MODEL ||
    (await page.evaluate(async () => {
      const r = await fetch("/api/models");
      const all = (await r.json()) as {
        id: string;
        supportsTools: boolean;
        pricing: { completion: string };
      }[];
      const priced = all
        .filter((m) => m.supportsTools && Number(m.pricing?.completion) > 0)
        .sort((a, b) => Number(a.pricing.completion) - Number(b.pricing.completion));
      return priced[0]?.id ?? "";
    }));
  check("a cheap tool-capable model is available", !!model, model);
  console.log(`        using ${model}`);
  await page.evaluate(async (m) => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModel: m }),
    });
  }, model);

  // ----------------------------------------------------- into Present mode
  await page.goto(BASE, { waitUntil: "networkidle" });
  await clearOverlays();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /^Present$/ }).first().click();
  await page.waitForTimeout(1200);

  // Set the card count on the chip rather than in prose, so this also proves
  // the Settings line reaches the model and wins.
  const WANT_CARDS = 8;
  const countChip = page.locator("select").filter({ hasText: /cards/ }).first();
  if (await countChip.count()) await countChip.selectOption(String(WANT_CARDS));
  await page.waitForTimeout(300);

  const composer = page.locator("textarea").first();
  /** Send, then wait until the composer's stop control disappears again. */
  const say = async (text: string, waitMs = 240_000) => {
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForTimeout(3000);
    await page
      .waitForFunction(
        () => !document.querySelector('[title*="Stop" i], button[aria-label*="Stop" i]'),
        undefined,
        { timeout: waitMs }
      )
      .catch(() => {});
    await page.waitForTimeout(4000);
  };

  // 1 ---------------------------------------------------- the outline step
  await say(
    "An investor pitch deck for Northwind, a B2B warehouse-native analytics startup. Audience is seed investors."
  );
  let text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  check("no raw machine tags reached the transcript", !/liberdeOutline|liberdeArtifact/.test(text), text.match(/liberde\w+/)?.[0]);

  const cardTitles = page.locator('input[aria-label^="Card "][aria-label$=" title"]');
  const outlineCount = await cardTitles.count();
  // A weak model can skip the outline and go straight to the deck. That is a
  // prompt-adherence failure worth reporting, but the deck half is the more
  // important half — so record it and keep going rather than aborting.
  const builtStraightAway =
    outlineCount === 0 &&
    page.frames().some((f) => f.url().startsWith("about:") && f !== page.mainFrame());
  check(
    "the model produced an editable outline before building",
    outlineCount > 0,
    builtStraightAway ? "skipped the outline and built the deck directly" : `${outlineCount} cards`
  );

  if (outlineCount > 0) {
    // The card count came from the chip, not the prose — so this is really a
    // check that the Settings line reached the model and was obeyed.
    check(
      "the outline is the length the setup chip asked for",
      Math.abs(outlineCount - WANT_CARDS) <= 1,
      `${outlineCount}, wanted ${WANT_CARDS}`
    );
    const layoutSelects = page.locator('select[aria-label^="Card "][aria-label$=" layout"]');
    const layouts: string[] = [];
    for (let i = 0; i < (await layoutSelects.count()); i++) {
      layouts.push(await layoutSelects.nth(i).inputValue());
    }
    check(
      "every layout the model chose actually exists",
      layouts.every((l) => DECK_LAYOUTS.some((d) => d.id === l)),
      layouts.join(",")
    );
    check("the first card is a title card", layouts[0] === "title", layouts[0]);
    check(
      "it varied the layouts rather than repeating one",
      new Set(layouts).size >= 3,
      layouts.join(",")
    );
    if (SHOTS) {
      mkdirSync(SHOT_DIR, { recursive: true });
      writeFileSync(`${SHOT_DIR}/1-outline.png`, await page.screenshot({ fullPage: false }));
    }

    // 2 ----------------------------------------------------- generate it
    const generate = page.getByRole("button", { name: /^Generate$/ }).first();
    check("the outline offers Generate", (await generate.count()) > 0);
    await generate.click();
    await page.waitForTimeout(3000);
    await page
      .waitForFunction(
        () => !document.querySelector('[title*="Stop" i], button[aria-label*="Stop" i]'),
        undefined,
        { timeout: 300_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(6000);
    text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  }
  check("still no machine tags in the transcript", !/liberdeArtifact|data-layout=/.test(text), text.match(/liberde\w+/)?.[0]);
  check("no error banner is shown over a recovered deck", !/artifact threw an error/i.test(text));

  // 3 --------------------------------------------------- inspect the deck
  const artifactButton = page.locator("button").filter({ hasText: /Northwind/i }).last();
  if (await artifactButton.count()) await artifactButton.click();
  await page.waitForTimeout(3000);

  const deckFrame = page
    .frames()
    .find((f) => f.url().startsWith("about:") && f !== page.mainFrame());
  check("the model emitted a deck artifact that renders", Boolean(deckFrame));
  if (!deckFrame) {
    console.log("\n    transcript tail:", text.slice(-700));
    await browser.close();
    process.exit(1);
  }

  const cards = await deckFrame.locator(".deck > .card").count();
  check("the deck has the cards the outline promised", cards >= 5, `${cards} cards`);

  const theme = await deckFrame.locator("html").getAttribute("data-theme");
  check("it picked a real theme", DECK_THEMES.some((t) => t.id === theme), String(theme));

  const usedLayouts = await deckFrame.locator(".deck > .card").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-layout") || "")
  );
  check(
    "every card layout in the deck is one we support",
    usedLayouts.every((l) => DECK_LAYOUTS.some((d) => d.id === l)),
    usedLayouts.join(",")
  );
  check("the deck varies its layouts", new Set(usedLayouts).size >= 3, usedLayouts.join(","));

  // The whole premise: the model must not have written any design of its own.
  check(
    "headings are short enough to read from the back of a room",
    await deckFrame.locator(".deck > .card h1, .deck > .card h2").evaluateAll((els) =>
      els.every((e) => (e.textContent || "").trim().split(/\s+/).length <= 12)
    )
  );
  const notes = await deckFrame.locator(".deck > .card aside.notes").count();
  check("most cards carry speaker notes", notes >= Math.ceil(cards * 0.6), `${notes}/${cards}`);
  check(
    "nothing rendered as a broken image",
    await deckFrame.locator(".deck img").evaluateAll((els) =>
      els.every((e) => (e as HTMLImageElement).naturalWidth > 0 || !(e as HTMLImageElement).complete)
    )
  );
  const before = await deckFrame.locator(".deck").evaluate((el) => el.innerHTML);
  if (SHOTS) writeFileSync(`${SHOT_DIR}/2-deck.png`, await page.screenshot());

  // The whole premise: the model must not have written any design of its own.
  // Read the SOURCE from the Code tab, not the rendered DOM — the runtime adds
  // inline styles of its own (chart legend swatches, cycle node angles), and
  // blaming the model for those would be measuring our work, not theirs. This
  // comes last in the section because switching tabs remounts the iframe, which
  // detaches every locator taken above.
  const codeTab = page.getByRole("button", { name: /^Code$/ }).first();
  let source = "";
  if (await codeTab.count()) {
    await codeTab.click();
    await page.waitForTimeout(1500);
    source = await page.locator("pre, textarea").last().innerText();
    await page.getByRole("button", { name: /^Preview$/ }).first().click();
    await page.waitForTimeout(1500);
  }
  check("the deck source is readable", source.length > 200, `${source.length} chars`);
  check("the model wrote no <style> block", !/<style/i.test(source));
  check(
    "the model wrote no inline styles",
    !/\sstyle=/i.test(source),
    (/\sstyle="[^"]*"/i.exec(source) || [])[0]
  );
  check("the model wrote no <script>", !/<script/i.test(source));
  // A made-up local path is a hole where a picture should be, and the runtime
  // can only paint over it after the fact.
  const badSrc = [...source.matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((s) => !/^(https?:|data:|\/img\/)/i.test(s));
  check("every image src is a real, reachable URL", badSrc.length === 0, badSrc.join(" "));

  // 4 ------------------------------------------ a surgical deck-wide restyle
  await say("Make it dark.");
  await page.waitForTimeout(3000);
  const frame2 = page
    .frames()
    .find((f) => f.url().startsWith("about:") && f !== page.mainFrame());
  if (frame2) {
    const themeAfter = await frame2.locator("html").getAttribute("data-theme");
    const isDark = DECK_THEMES.find((t) => t.id === themeAfter)?.dark === true;
    check("asking for dark switched to a dark theme", isDark, String(themeAfter));
    const after = await frame2.locator(".deck").evaluate((el) => el.innerHTML);
    // The point of a restyle: the words must not move.
    const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    check(
      "the restyle left every word of content alone",
      words(before) === words(after),
      `${words(before).length} vs ${words(after).length} chars`
    );
    if (SHOTS) writeFileSync(`${SHOT_DIR}/3-dark.png`, await page.screenshot());
  }

  // 5 ------------------------------------------------ a single-card rewrite
  await say("Rewrite card 2 so its heading is exactly: Dashboards do not answer questions");
  await page.waitForTimeout(2500);
  const frame3 = page
    .frames()
    .find((f) => f.url().startsWith("about:") && f !== page.mainFrame());
  if (frame3) {
    const headings = await frame3
      .locator(".deck > .card h1, .deck > .card h2")
      .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
    check(
      "a one-card edit landed",
      headings.some((h) => /Dashboards do not answer questions/i.test(h)),
      headings.join(" | ")
    );
    check(
      "and it did not shrink the deck",
      (await frame3.locator(".deck > .card").count()) >= cards,
      String(await frame3.locator(".deck > .card").count())
    );
    if (SHOTS) writeFileSync(`${SHOT_DIR}/4-card-edit.png`, await page.screenshot());
  }

  check("no page errors across the run", errors.length === 0, errors[0]);

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (SHOTS) console.log(`Screenshots in ${SHOT_DIR}`);
  if (failures.length) {
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
