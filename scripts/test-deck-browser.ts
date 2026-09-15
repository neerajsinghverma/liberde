/**
 * Drive the deck runtime in a real browser.
 *
 * Everything else about a deck can be asserted on strings: the markup is there,
 * the themes are declared, the script is inlined. What a string cannot tell you
 * is whether the runtime BOOTS — whether columns actually get wrapped, icons
 * get injected, the chart draws, present mode shows exactly one card, spotlight
 * blurs the rest, and a notes edit hands back the pristine source rather than
 * the DOM full of runtime-injected SVG. Those are browser questions.
 *
 * It renders inside a sandboxed iframe with no allow-same-origin, exactly as
 * ArtifactPanel does, so the opaque origin is part of what is tested.
 *
 *   npx tsx scripts/test-deck-browser.ts [--shots]
 *
 * Needs playwright and a chromium build; skips cleanly (exit 0) when absent.
 */

import { buildDeckSrcDoc } from "../lib/deck-srcdoc";
import { DECK_THEMES } from "../lib/deck-runtime";
import { mkdirSync, writeFileSync } from "node:fs";

const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "C:/Users/nverma/AppData/Local/Temp/3/claude/C--src-Liberde/deck-shots";

const DECK = `<div class="deck" data-theme="aurora" data-format="presentation" data-size="fluid" data-density="medium">
<section class="card" data-layout="title">
  <p class="kicker">Series A</p><h1>Analytics that answer</h1>
  <p class="lede">Ship insight, not dashboards.</p>
  <figure data-placeholder="abstract data network" data-icon="rocket"></figure>
  <aside class="notes">Open warm and slow.</aside>
</section>
<section class="card" data-layout="bullets">
  <h2>Why teams switch</h2>
  <ul><li data-icon="bolt"><b>Fast</b> answers in seconds</li><li data-icon="shield">Governed by default</li><li data-icon="users">Built for analysts</li></ul>
  <aside class="notes">Three reasons, no more.</aside>
</section>
<section class="card" data-layout="stats">
  <h2>Traction</h2>
  <div class="stat"><b>42%</b><span>MoM growth</span></div>
  <div class="stat"><b>1.2M</b><span>Events per day</span></div>
  <div class="stat"><b>18</b><span>Design partners</span></div>
</section>
<section class="card" data-layout="columns-3">
  <h2>How it works</h2>
  <div class="col"><h3>Connect</h3><p>Point it at your warehouse.</p></div>
  <div class="col"><h3>Ask</h3><p>Plain questions, typed.</p></div>
  <div class="col"><h3>Act</h3><p>Answers land in Slack.</p></div>
</section>
<section class="card" data-layout="timeline">
  <h2>Roadmap</h2>
  <ol class="steps"><li><b>Q1</b><span>Warehouse connectors</span></li><li><b>Q2</b><span>Semantic layer</span></li><li><b>Q3</b><span>Agents</span></li></ol>
</section>
<section class="card" data-layout="chart">
  <h2>Revenue by quarter</h2>
  <table data-chart="bar"><thead><tr><th>Quarter</th><th>ARR</th><th>Pipeline</th></tr></thead>
  <tbody><tr><td>Q1</td><td>1.2</td><td>2.0</td></tr><tr><td>Q2</td><td>1.8</td><td>2.6</td></tr><tr><td>Q3</td><td>2.4</td><td>3.1</td></tr></tbody></table>
</section>
<section class="card" data-layout="quote">
  <blockquote><p>We cancelled two BI contracts.</p><cite>Head of Data, Northwind</cite></blockquote>
</section>
<section class="card" data-layout="image-right">
  <h2>Built for the warehouse</h2><p>No extracts, no copies, no drift.</p>
  <figure data-placeholder="server room" data-icon="cloud"></figure>
</section>
<section class="card" data-layout="closing">
  <h1>Thanks</h1><p class="lede">Questions welcome.</p>
  <aside class="notes">Stop talking, take questions.</aside>
</section>
</div>`;

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the deck browser test.");
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

  // The same shell ArtifactPanel builds: sandboxed iframe, opaque origin,
  // content handed over as a srcdoc property (never written into markup).
  const mount = async (deck: string, view?: "scroll" | "present" | "presenter") => {
    await page.setContent(
      '<!doctype html><html><body style="margin:0">' +
        '<iframe id="f" sandbox="allow-scripts allow-forms allow-popups allow-modals" ' +
        'style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe></body></html>'
    );
    await page.evaluate(
      (doc) => {
        (document.getElementById("f") as HTMLIFrameElement).srcdoc = doc;
      },
      buildDeckSrcDoc(deck, view ? { view } : {})
    );
    const frame = page.frameLocator("#f");
    await frame.locator(".deck").waitFor({ state: "attached", timeout: 15000 });
    // The runtime posts deckReady once it has normalised every card.
    await page.waitForTimeout(700);
    return frame;
  };

  console.log("Deck runtime (browser):\n");

  // ---------------------------------------------------------------- scroll
  let frame = await mount(DECK);

  check("the runtime boots without a page error", pageErrors.length === 0, pageErrors[0]);
  check("every card is present", (await frame.locator(".deck > .card").count()) === 9);
  check(
    "columns are wrapped into a grid container",
    (await frame.locator('.card[data-layout="columns-3"] > .ld-cols > .col').count()) === 3
  );
  check(
    "stats are wrapped into a stats row",
    (await frame.locator('.card[data-layout="stats"] > .ld-stats > .stat').count()) === 3
  );
  check(
    "icon bullets get real SVG icons",
    (await frame.locator('.card[data-layout="bullets"] li > svg.ld-ico').count()) === 3
  );
  check(
    "placeholder figures render an on-theme tile",
    (await frame.locator("figure .ld-ph").count()) === 2
  );
  check(
    "the chart table is replaced by an SVG chart and hidden",
    (await frame.locator("svg.ld-chart rect").count()) > 0 &&
      (await frame.locator("table.chart-src").count()) === 1
  );
  check(
    "the chart legend names both series",
    (await frame.locator(".ld-legend span").count()) === 2
  );
  check(
    "speaker notes never render on the card",
    !(await frame.locator("aside.notes").first().isVisible())
  );
  check(
    "the theme is applied to the document root",
    (await frame.locator("html").getAttribute("data-theme")) === "aurora"
  );

  // Typography actually scales with the card, which is the whole point of
  // using container query units rather than fixed pixels.
  const h1Size = await frame.locator("h1").first().evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize)
  );
  check("the title scales up on a wide card", h1Size > 48, `${h1Size}px`);

  const statColor = await frame
    .locator(".stat > b")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  check("stat numerals use the theme gradient", statColor.includes("gradient"));

  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(`${SHOT_DIR}/scroll.png`, await page.screenshot({ fullPage: false }));
  }

  // --------------------------------------------------------------- present
  frame = await mount(DECK, "present");
  const visibleCards = async () => {
    let n = 0;
    for (let i = 0; i < 9; i++) {
      if (await frame.locator(".deck > .card").nth(i).isVisible()) n++;
    }
    return n;
  };
  // Keys go to the deck document, which is what a focused present tab does.
  const key = (k: string) => frame.locator("body").press(k);

  check("present mode shows exactly one card", (await visibleCards()) === 1);
  check(
    "the progress bar is showing",
    await frame.locator("#ld-progress").isVisible()
  );
  check("the counter starts at card 1", (await frame.locator("#ld-count").textContent()) === "1 / 9");

  await key("ArrowRight");
  await page.waitForTimeout(250);
  check("right arrow advances", (await frame.locator("#ld-count").textContent()) === "2 / 9");
  check("still exactly one card visible", (await visibleCards()) === 1);

  await key("ArrowLeft");
  await page.waitForTimeout(200);
  check("left arrow goes back", (await frame.locator("#ld-count").textContent()) === "1 / 9");

  await key("End");
  await page.waitForTimeout(250);
  check("End jumps to the last card", (await frame.locator("#ld-count").textContent()) === "9 / 9");
  await key("Home");
  await page.waitForTimeout(250);

  // Spotlight: reveal one block at a time, blur the rest.
  await key("ArrowRight");
  await page.waitForTimeout(200);
  await key("s");
  await page.waitForTimeout(350);
  const blurred = await frame
    .locator('.card[data-layout="bullets"] > ul')
    .evaluate((el) => getComputedStyle(el).filter);
  check("spotlight blurs what has not been revealed", blurred.includes("blur"), blurred);

  // One press reveals the next block and must NOT move the deck on.
  await key("ArrowRight");
  await page.waitForTimeout(350);
  const lit = await frame
    .locator('.card[data-layout="bullets"] > ul')
    .evaluate((el) => getComputedStyle(el).filter);
  check("advancing reveals the next block", lit === "none", lit);
  check(
    "spotlight holds the card while blocks remain",
    (await frame.locator("#ld-count").textContent()) === "2 / 9"
  );
  // Once every block is lit, the next press moves on as usual.
  await key("ArrowRight");
  await page.waitForTimeout(350);
  check(
    "the card advances once the last block is revealed",
    (await frame.locator("#ld-count").textContent()) === "3 / 9"
  );
  await key("Escape");
  await page.waitForTimeout(250);

  if (SHOTS) writeFileSync(`${SHOT_DIR}/present.png`, await page.screenshot());

  // ----------------------------------------------------------------- notes
  frame = await mount(DECK, "present");
  const saved = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        window.addEventListener("message", (e) => {
          const d = e.data as { __ld?: string; content?: string };
          if (d && d.__ld === "notesSaved" && typeof d.content === "string") resolve(d.content);
        });
      })
  );
  await key("n");
  await page.waitForTimeout(250);
  await frame.locator("#ld-notes-text").fill("Rewritten note for card one.");
  await key("Tab");
  await page.waitForTimeout(400);
  const savedHtml = await Promise.race([
    saved,
    page.waitForTimeout(4000).then(() => ""),
  ]);
  check("editing notes hands the deck back to the host", savedHtml.length > 0);
  check("the saved note is the new text", savedHtml.includes("Rewritten note for card one."));
  check(
    "the saved markup is the pristine source, not the rendered DOM",
    savedHtml.length > 0 &&
      !savedHtml.includes("ld-ico") &&
      !savedHtml.includes("ld-cols") &&
      !savedHtml.includes("ld-chart") &&
      !savedHtml.includes("chart-src") &&
      savedHtml.includes('data-layout="stats"')
  );

  // ---------------------------------------------------- unbalanced markup
  // A live model (mistral-nemo, 2026-09-15) left one <b> unclosed inside a
  // stat. The browser then nested every following <section> inside it and half
  // the deck vanished — 8 cards authored, 4 rendered. The runtime has to
  // reassemble a deck from markup that does not close its own tags, because
  // that is the one mistake no amount of prompting reliably prevents.
  frame = await mount(DECK.replace("<b>42%</b>", "<b>42%"));
  const recovered = await frame.locator(".deck > .card").count();
  check("an unclosed tag does not swallow the rest of the deck", recovered === 9, String(recovered));
  const order = (
    await frame
      .locator(".deck > .card")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-layout")))
  ).join(",");
  check(
    "the recovered cards stay in their authored order",
    order === "title,bullets,stats,columns-3,timeline,chart,quote,image-right,closing",
    order
  );
  check(
    "debris left behind by the rescue is hidden",
    await frame
      .locator(".deck > b")
      .first()
      .evaluate((el) => getComputedStyle(el).display === "none")
      .catch(() => true)
  );

  // ----------------------------------------------------------- theme swap
  frame = await mount(DECK);
  const bgBefore = await frame
    .locator(".card")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => {
    const f = document.getElementById("f") as HTMLIFrameElement;
    f.contentWindow?.postMessage({ __ld: "setAttr", attr: "data-theme", value: "neon" }, "*");
  });
  await page.waitForTimeout(500);
  const bgAfter = await frame
    .locator(".card")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  check("a live theme swap repaints the deck", bgBefore !== bgAfter, `${bgBefore} -> ${bgAfter}`);
  check(
    "the swapped theme reaches the document root",
    (await frame.locator("html").getAttribute("data-theme")) === "neon"
  );
  check(
    "charts are redrawn in the new theme rather than left behind",
    (await frame.locator("svg.ld-chart").count()) === 1
  );

  // ---------------------------------------------------------- the formats
  for (const fmt of ["document", "webpage", "social"] as const) {
    const swapped = DECK.replace('data-format="presentation"', `data-format="${fmt}"`);
    frame = await mount(swapped);
    check(
      `${fmt} format renders every card`,
      (await frame.locator(".deck > .card").count()) === 9
    );
    if (fmt === "webpage") {
      check("webpage builds a sticky nav from the headings", await frame.locator("#ld-nav").isVisible());
    }
    if (fmt === "document") {
      check("document builds a table of contents", await frame.locator("#ld-toc").isVisible());
    }
    if (SHOTS) writeFileSync(`${SHOT_DIR}/${fmt}.png`, await page.screenshot());
  }

  // ------------------------------------------------------ every theme paints
  let themeFailures = 0;
  for (const t of DECK_THEMES) {
    frame = await mount(DECK.replace('data-theme="aurora"', `data-theme="${t.id}"`));
    const [bg, ink] = await frame
      .locator(".card")
      .first()
      .evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === ink) themeFailures++;
    if (SHOTS) writeFileSync(`${SHOT_DIR}/theme-${t.id}.png`, await page.screenshot());
  }
  check(`all ${DECK_THEMES.length} themes paint a card`, themeFailures === 0, `${themeFailures} blank`);

  // ------------------------------------------------------------ narrow width
  await page.setViewportSize({ width: 400, height: 800 });
  frame = await mount(DECK);
  const overflow = await frame.locator("body").evaluate(
    (el) => el.scrollWidth - el.clientWidth
  );
  check("nothing overflows horizontally at phone width", overflow <= 2, `${overflow}px`);
  const colsStacked = await frame
    .locator('.card[data-layout="columns-3"] > .ld-cols')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  check("three columns stack on a narrow card", colsStacked === 1, `${colsStacked} columns`);
  if (SHOTS) writeFileSync(`${SHOT_DIR}/narrow.png`, await page.screenshot());

  check("no page errors across the whole run", pageErrors.length === 0, pageErrors[0]);

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
