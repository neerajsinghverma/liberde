/**
 * Present template tests.
 *
 * These values arrive from a model reading a customer's PDF and end up
 * interpolated into a <style> block, so the sanitisers are the security surface
 * of the whole feature. Every test below is about what happens when the input
 * is wrong rather than when it is right.
 */
import assert from "node:assert";
import {
  flatHex,
  sanitiseFontsQuery,
  sanitiseLayoutCss,
  sanitiseLayouts,
  sanitiseLogo,
  sanitiseLogoPos,
  sanitiseTokenValue,
  sanitiseTokens,
  templateCss,
  templatePptxPalette,
  templatePromptBlock,
  TEMPLATE_TOKENS,
} from "../lib/deck-template";
import { buildDeckSrcDoc } from "../lib/deck-srcdoc";
import { TOKEN_REFERENCE } from "../lib/deck-runtime";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("Present templates:");

ok("good token values survive untouched", () => {
  const tokens = sanitiseTokens({
    bg: "linear-gradient(140deg,#f5f3ff 0%,#e0f2fe 100%)",
    surface: "#ffffff",
    ink: "#0f172a",
    accent: "#2563eb",
    radius: "18px",
    shadow: "0 12px 32px rgba(15,23,42,.08)",
    "heading-font": "Inter, ui-sans-serif, sans-serif",
    "heading-weight": "700",
  });
  assert.equal(tokens.surface, "#ffffff");
  assert.ok(tokens.bg.startsWith("linear-gradient("));
  assert.equal(tokens.shadow, "0 12px 32px rgba(15,23,42,.08)");
  assert.equal(Object.keys(tokens).length, 8);
});

ok("a value that could escape its declaration is dropped", () => {
  // Each of these would corrupt every rule after it, or reach outside the deck.
  for (const bad of [
    "#fff} body{display:none",
    "red; position:fixed",
    "url(http://evil.test/x.png)",
    "expression(alert(1))",
    "/* comment */ red",
    "<script>",
  ]) {
    assert.equal(sanitiseTokenValue(bad), null, `should reject: ${bad}`);
  }
  // And a whole object of them yields nothing rather than partial damage.
  assert.deepEqual(sanitiseTokens({ bg: "#fff} body{display:none", ink: "blue" }), {
    ink: "blue",
  });
});

ok("no token may carry a url, however innocent", () => {
  // A data URI contains a semicolon, and a semicolon inside one declaration is
  // precisely what corrupts every rule after it. Rather than telling a good
  // semicolon from a bad one, tokens carry colour and geometry only.
  assert.equal(sanitiseTokenValue("url(data:image/png;base64,iVBORw0KG)"), null);
  assert.equal(sanitiseTokenValue("url(https://cdn.example.com/bg.png)"), null);
  // Gradients, which is what a brand background actually needs, are fine.
  assert.ok(sanitiseTokenValue("linear-gradient(90deg,#fff,#000)"));
});

ok("unknown token names cannot be introduced", () => {
  const tokens = sanitiseTokens({ accent: "#123456", position: "fixed", "--evil": "x" });
  assert.deepEqual(Object.keys(tokens), ["accent"]);
});

ok("an over-long value is rejected rather than truncated", () => {
  assert.equal(sanitiseTokenValue("#" + "a".repeat(400)), null);
});

ok("layout ids are forced into the custom- namespace", () => {
  const layouts = sanitiseLayouts([
    { id: "title", label: "Title", hint: "opener" },
    { id: "custom-three-up", label: "Three up", hint: "three columns" },
    { id: "Custom Hero!!", label: "Hero", hint: "" },
  ]);
  assert.deepEqual(
    layouts.map((l) => l.id),
    ["custom-title", "custom-three-up", "custom-hero"]
  );
  // So a template can never shadow or redefine a built-in layout.
  assert.ok(layouts.every((l) => l.id.startsWith("custom-")));
});

ok("duplicate and malformed layouts are dropped", () => {
  const layouts = sanitiseLayouts([
    { id: "custom-a", label: "A", hint: "" },
    { id: "custom-a", label: "A again", hint: "" },
    { id: "", label: "nameless", hint: "" },
    "not an object",
    null,
  ]);
  assert.equal(layouts.length, 1);
  assert.equal(sanitiseLayouts("nope").length, 0);
});

const LAYOUTS = sanitiseLayouts([{ id: "custom-hero", label: "Hero", hint: "opener" }]);

ok("layout css must be scoped to the template's own layouts", () => {
  const css = sanitiseLayoutCss(
    `.card[data-layout="custom-hero"]{grid-template-columns:1fr 1fr}
     .card[data-layout="custom-hero"] h1{color:var(--accent)}`,
    LAYOUTS
  );
  assert.ok(css && css.includes("custom-hero"));
  assert.equal((css!.match(/\{/g) || []).length, 2);
});

ok("a rule reaching outside its layout is discarded", () => {
  // The important cases: restyling a built-in layout, and hiding the app's own
  // controls so a deck looks broken with no way back.
  const css = sanitiseLayoutCss(
    `.card[data-layout="custom-hero"]{color:var(--ink)}
     .card[data-layout="stats"]{display:none}
     #ld-ctl{display:none}
     body{background:red}
     .card{opacity:0}`,
    LAYOUTS
  );
  assert.ok(css);
  assert.ok(css!.includes("custom-hero"));
  assert.ok(!css!.includes("ld-ctl"));
  assert.ok(!/data-layout="stats"/.test(css!));
  assert.ok(!/body\{/.test(css!));
});

ok("at-rules and hostile urls in layout css are refused", () => {
  assert.equal(sanitiseLayoutCss('@import url("x");', LAYOUTS), null);
  const css = sanitiseLayoutCss(
    `.card[data-layout="custom-hero"]{background:url(http://evil.test/x.png)}
     .card[data-layout="custom-hero"] h1{color:red}`,
    LAYOUTS
  );
  assert.ok(css && !css.includes("evil.test"), "http url dropped, rest kept");
  assert.ok(css!.includes("color:red"));
});

ok("layout css with no layouts to scope to is refused outright", () => {
  assert.equal(sanitiseLayoutCss('.card[data-layout="custom-hero"]{color:red}', []), null);
});

ok("logos and fonts queries are validated", () => {
  assert.ok(sanitiseLogo("https://example.com/logo.svg"));
  assert.ok(sanitiseLogo("/img/abc-123"));
  assert.ok(sanitiseLogo("data:image/png;base64,iVBORw0KGgo="));
  assert.equal(sanitiseLogo("javascript:alert(1)"), null);
  assert.equal(sanitiseLogo("http://insecure.test/logo.png"), null);
  assert.equal(sanitiseLogoPos("br"), "br");
  assert.equal(sanitiseLogoPos("middle"), null);
  assert.ok(sanitiseFontsQuery("family=Inter:wght@400;700&family=Lora"));
  assert.equal(sanitiseFontsQuery("https://evil.test?family=X"), null);
  assert.equal(sanitiseFontsQuery("Inter"), null, "must actually be a families query");
});

ok("template css binds to the custom theme id only", () => {
  const css = templateCss({
    tokens: { accent: "#ff0000", ink: "#111111" },
    layout_css: '.card[data-layout="custom-hero"]{color:red}',
  });
  assert.ok(css.includes('.deck[data-theme="custom"]'));
  assert.ok(css.includes("--accent:#ff0000"));
  assert.ok(css.includes("custom-hero"));
  // It must not touch any built-in theme.
  assert.ok(!/data-theme="(aurora|slate|neon)"/.test(css));
});

ok("a deck document carries the template's brand and fonts", () => {
  const deck = '<div class="deck" data-theme="custom" data-template="t1"><section class="card"><h1>Hi</h1></section></div>';
  const doc = buildDeckSrcDoc(deck, {
    template: {
      tokens: { accent: "#ff0000" },
      layout_css: null,
      fonts_query: "family=Lora:wght@500",
    },
  });
  assert.ok(doc.includes("--accent:#ff0000"));
  assert.ok(doc.includes("family=Lora:wght@500"), "font query reaches the runtime map");
  assert.ok(doc.includes('"custom":"family=Lora:wght@500"'));
  // And a deck with no template is unchanged.
  assert.ok(!buildDeckSrcDoc(deck).includes("--accent:#ff0000"));
});

ok("PowerPoint gets flat hexes, never a gradient", () => {
  assert.equal(flatHex("linear-gradient(140deg,#f5f3ff 0%,#e0f2fe 100%)", "FFFFFF"), "F5F3FF");
  assert.equal(flatHex("#abc", "FFFFFF"), "AABBCC");
  assert.equal(flatHex("rgba(0,0,0,.5)", "FFFFFF"), "FFFFFF");
  assert.equal(flatHex(undefined, "123456"), "123456");
  const palette = templatePptxPalette(
    { tokens: { bg: "linear-gradient(90deg,#001122,#334455)", accent: "#ff0000" } },
    { bg: "FFFFFF", surface: "FFFFFF", ink: "000000", accent: "2563EB" }
  );
  assert.equal(palette.bg, "001122");
  assert.equal(palette.accent, "FF0000");
  assert.equal(palette.ink, "000000", "falls back where the template says nothing");
});

ok("the prompt block tells the model to record the template id", () => {
  const block = templatePromptBlock(
    {
      id: "tpl-42",
      name: "Acme",
      image_style: "flat vector, navy",
      layouts: LAYOUTS,
      notes: "Never use the old teal.",
      logo: "https://example.com/logo.svg",
      logo_pos: "br",
    },
    "layouts"
  );
  assert.ok(block.includes('data-theme="custom"'));
  assert.ok(block.includes('data-template="tpl-42"'), "the id must be recorded in the markup");
  assert.ok(block.includes("custom-hero"), "its layouts are offered");
  assert.ok(block.includes("flat vector, navy"));
  assert.ok(block.includes("Never use the old teal."));
  assert.ok(block.includes('data-hf-br="logo:https://example.com/logo.svg"'));
});

ok("brand-only mode withholds the template's layouts", () => {
  const block = templatePromptBlock(
    { id: "t", name: "Acme", image_style: null, layouts: LAYOUTS, notes: null, logo: null, logo_pos: null },
    "skin"
  );
  assert.ok(block.includes("brand skin only"));
  assert.ok(!block.includes("custom-hero — opener"), "the catalogue is not offered");
});

ok("the extraction prompt offers exactly the tokens that exist", () => {
  for (const token of TEMPLATE_TOKENS) {
    assert.ok(
      TOKEN_REFERENCE.includes("- " + token + ":"),
      `the token reference documents ${token}`
    );
  }
});

console.log(`\n${passed} tests passed.`);
