/**
 * Does the exact PowerPoint export actually look like the deck?
 *
 * The editable exporter rebuilds each card out of PowerPoint text boxes, which
 * is why an exported deck looked nothing like the deck: every gradient,
 * rounded corner, icon and smart-layout shape is thrown away on the way. The
 * exact exporter instead photographs the real cards, so the only question that
 * matters is whether the photograph is faithful — the right size, the right
 * colours, the right typeface, and not blank.
 *
 * A .pptx is a zip of XML and proving anything about its appearance is
 * hopeless, so this tests the step that decides the appearance: the capture.
 * It runs html-to-image in a real browser against the real runtime, exactly as
 * the export does, and reads pixels back out of the result.
 *
 *   npx tsx scripts/test-deck-capture.ts [--shots]
 */

import { buildDeckSrcDoc } from "../lib/deck-srcdoc";
import { mkdirSync, writeFileSync } from "node:fs";

const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "C:/Users/nverma/AppData/Local/Temp/3/claude/C--src-Liberde/deck-shots";

// A deck whose look depends entirely on things the editable exporter loses.
const DECK = `<div class="deck" data-theme="custom" data-template="t1" data-format="presentation" data-size="16x9" data-density="medium">
<section class="card" data-layout="title"><p class="kicker">Acme</p><h1>Exactly this</h1><p class="lede">Gradient stats, icons and a funnel.</p></section>
<section class="card" data-layout="stats"><h2>The numbers</h2><div class="stat"><b>38%</b><span>Faster</span></div><div class="stat"><b>2.4x</b><span>Return</span></div></section>
<section class="card" data-layout="bullets"><h2>Why</h2><ul><li data-icon="bolt">Fast</li><li data-icon="shield">Safe</li></ul></section>
<section class="card" data-layout="funnel"><h2>Funnel</h2><ol class="steps"><li><b>Visits</b><span>10k</span></li><li><b>Trials</b><span>1k</span></li><li><b>Paid</b><span>120</span></li></ol></section>
</div>`;

// Deliberately unlike any built-in theme, so a capture that missed the brand is
// obvious in the pixels rather than a judgement call.
const TEMPLATE = {
  tokens: {
    bg: "#0a1f1c",
    surface: "#12332e",
    ink: "#eafff7",
    muted: "#7fb8a8",
    accent: "#ffd166",
    "accent-2": "#06d6a0",
    radius: "2px",
    shadow: "none",
    stroke: "2px solid #ffd166",
    "heading-font": "Georgia, serif",
    "body-font": "Georgia, serif",
  },
  layout_css: null,
  fonts_query: null,
};

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the capture test.");
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
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  console.log("Exact PowerPoint capture:\n");

  // The browser-side work is written as a plain string, not a function passed
  // to evaluate. tsx compiles this file with esbuild, which rewrites named
  // functions to call a __name helper that does not exist in the page, so a
  // serialised closure fails with "__name is not defined".
  const BROWSER_CODE = `
window.__capture = async function (doc) {
  var h2i = await (new Function("u", "return import(u)")("https://esm.sh/html-to-image@1.11.11"));
  var host = document.createElement("iframe");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:1600px;height:1000px;border:0";
  document.body.appendChild(host);
  var idoc = host.contentDocument;
  idoc.open(); idoc.write(doc); idoc.close();
  try { await idoc.fonts.ready; } catch (e) {}
  await new Promise(function (r) { setTimeout(r, 1400); });
  var cards = Array.prototype.slice.call(idoc.querySelectorAll(".deck > .card"));
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var rect = cards[i].getBoundingClientRect();
    var notes = cards[i].querySelector("aside.notes");
    out.push({
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      url: await h2i.toPng(cards[i], { pixelRatio: 2, cacheBust: true }),
      notes: notes ? notes.textContent.trim() : ""
    });
  }
  host.remove();
  return out;
};
window.__colours = function (urls) {
  return Promise.all(urls.map(function (url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        var counts = {};
        var step = Math.max(4, Math.floor(img.width / 120));
        for (var x = 0; x < img.width; x += step) {
          for (var y = 0; y < img.height; y += step) {
            var d = ctx.getImageData(x, y, 1, 1).data;
            var key = d[0] + "," + d[1] + "," + d[2];
            counts[key] = (counts[key] || 0) + 1;
          }
        }
        resolve({ counts: counts });
      };
      img.onerror = function () { resolve({ counts: {} }); };
      img.src = url;
    });
  }));
};`;

  // The host page is same-origin, which is what the real export relies on:
  // html-to-image must read computed styles, and the sandboxed preview frame
  // forbids that.
  await page.setContent(
    '<!doctype html><html><body style="margin:0"><script>' +
      BROWSER_CODE +
      "</scr" +
      "ipt></body></html>"
  );
  const srcdoc = buildDeckSrcDoc(DECK, { template: TEMPLATE });

  const result = (await page.evaluate(
    `window.__capture(${JSON.stringify(srcdoc)})`
  )) as { w: number; h: number; url: string; notes: string }[];

  check("every card was captured", result.length === 4, `${result.length} of 4`);
  check(
    "each capture is a real PNG, not an empty one",
    result.every((c) => c.url.startsWith("data:image/png;base64,") && c.url.length > 8000),
    result.map((c) => c.url.length).join(",")
  );
  check(
    "a 16:9 deck captures at 16:9",
    result.every((c) => Math.abs(c.w / c.h - 16 / 9) < 0.02),
    result.map((c) => (c.w / c.h).toFixed(3)).join(",")
  );

  // Read the pixels back. This is the whole point: a capture that silently
  // lost the brand still looks like a valid PNG.
  const sampled = (await page.evaluate(
    `window.__colours(${JSON.stringify(result.map((c) => c.url))})`
  )) as { counts: Record<string, number> }[];

  const near = (rgb: string, target: [number, number, number], tol = 10) => {
    const [r, g, b] = rgb.split(",").map(Number);
    return (
      Math.abs(r - target[0]) <= tol &&
      Math.abs(g - target[1]) <= tol &&
      Math.abs(b - target[2]) <= tol
    );
  };

  // #12332e, the template's card surface.
  const surfaceSeen = sampled.every((s) =>
    Object.keys(s.counts).some((k) => near(k, [18, 51, 46], 12))
  );
  check("the captured card carries the template's surface colour", surfaceSeen);

  // #ffd166, the template's accent: the kicker, the stat gradient, the border.
  const accentSeen = sampled.filter((s) =>
    Object.keys(s.counts).some((k) => near(k, [255, 209, 102], 24))
  ).length;
  check("the accent survives the capture", accentSeen >= 3, `${accentSeen} of 4 cards`);

  const blank = sampled.filter((s) => Object.keys(s.counts).length <= 2).length;
  check("no card captured as a flat blank", blank === 0, `${blank} blank`);

  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    result.forEach((c, i) => {
      writeFileSync(
        `${SHOT_DIR}/capture-${i + 1}.png`,
        Buffer.from(c.url.split(",")[1], "base64")
      );
    });
  }

  check("no page errors during capture", errors.length === 0, errors[0]);

  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (SHOTS) console.log(`Captures in ${SHOT_DIR}`);
  if (failures.length) {
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
