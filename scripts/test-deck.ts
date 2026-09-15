/* Deck artifact tests (Present mode): parsing, runtime document, theme
 * switching, outline stripping, storage and publish. */
import assert from "node:assert";
import { parseArtifactBlocks, ARTIFACT_TYPES } from "../lib/artifact-shared";
import { buildSrcDoc } from "../lib/artifact-srcdoc";
import { buildDeckSrcDoc } from "../lib/deck-srcdoc";
import {
  DECK_FORMATS,
  DECK_LAYOUTS,
  DECK_SIZES,
  DECK_THEMES,
  deckLayoutTable,
  deckThemeCss,
  deckThemeTable,
  findDeckTheme,
  readDeckAttr,
  swapDeckAttr,
} from "../lib/deck-runtime";
import { presentDirective } from "../lib/present-prompt";
import { splitAsk } from "../lib/assistant-parts";
import { normaliseMath } from "../lib/math";
import { readableAssistantText } from "../lib/analysis";
import { processAssistantArtifacts } from "../lib/artifacts";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getArtifactByIdentifier,
  getArtifactVersion,
  setArtifactShare,
  getArtifactByShareId,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const DECK = `<div class="deck" data-theme="aurora" data-format="presentation" data-size="fluid" data-density="medium">
<section class="card" data-layout="title"><p class="kicker">Series A</p><h1>Analytics that answer</h1><p class="lede">Ship insight, not dashboards.</p><aside class="notes">Open warm.</aside></section>
<section class="card" data-layout="stats"><h2>Traction</h2><div class="stat"><b>42%</b><span>MoM growth</span></div><div class="stat"><b>1.2M</b><span>Events per day</span></div><aside class="notes">Lead with the number.</aside></section>
<section class="card" data-layout="chart"><h2>Revenue</h2><table data-chart="bar"><thead><tr><th>Quarter</th><th>Revenue</th></tr></thead><tbody><tr><td>Q1</td><td>1.2</td></tr><tr><td>Q2</td><td>1.8</td></tr></tbody></table></section>
<section class="card" data-layout="closing"><h1>Thanks</h1><p class="lede">Questions welcome.</p></section>
</div>`;

console.log("Deck (Present mode):");

ok("deck is a first-class artifact type", () => {
  assert.ok(ARTIFACT_TYPES.includes("deck"));
  const blocks = parseArtifactBlocks(
    `<liberdeArtifact identifier="deck" command="create" type="deck" title="Analytics">\n${DECK}\n</liberdeArtifact>`
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "deck");
  assert.ok(blocks[0].content.includes('data-layout="stats"'));
});

ok("the runtime document carries theme tokens, chrome and the script", () => {
  const doc = buildDeckSrcDoc(DECK);
  assert.ok(doc.includes("Analytics that answer"), "card content embedded");
  assert.ok(doc.includes("ld-ctl"), "controls present");
  assert.ok(doc.includes("ld-progress"), "progress bar present");
  assert.ok(doc.includes("ld-presenter"), "presenter pane present");
  assert.ok(doc.includes("LD_FONTS"), "font map injected");
  assert.ok(doc.includes("break-after:page"), "print pagination present");
  assert.ok(doc.includes("ArrowRight"), "keyboard nav present");
  assert.ok(doc.includes("container-type:inline-size"), "container type scale present");
  for (const t of DECK_THEMES) {
    assert.ok(doc.includes(`data-theme="${t.id}"`), `theme ${t.id} defined`);
  }
});

ok("no stray template-literal or script-tag sequences in the runtime", () => {
  const doc = buildDeckSrcDoc(DECK);
  // A backtick or "${" inside the CSS/JS constants would have broken the
  // srcdoc template at build time; a literal closing script tag would end the
  // inline script early and leave a blank deck.
  const runtime = doc.slice(doc.indexOf("<style>"));
  assert.ok(!runtime.includes("${"), "no unresolved interpolation");
  const opens = (runtime.match(/<script[\s>]/g) || []).length;
  const closes = runtime.split("</scr" + "ipt>").length - 1;
  assert.equal(opens, closes, "every inline script closes exactly once");
  assert.ok(opens >= 2, "globals and runtime are both injected");
});

ok("view option selects scroll, present or presenter", () => {
  assert.ok(buildDeckSrcDoc(DECK).includes('data-view="scroll"'));
  assert.ok(buildDeckSrcDoc(DECK, { view: "present" }).includes('data-view="present"'));
  assert.ok(buildDeckSrcDoc(DECK, { view: "presenter" }).includes('data-view="presenter"'));
  // The runtime always *references* LD_BEACON; only a published page declares it.
  assert.ok(buildDeckSrcDoc(DECK, { beacon: "/x" }).includes('var LD_BEACON="/x"'));
  assert.ok(!buildDeckSrcDoc(DECK).includes("var LD_BEACON"));
});

ok("buildSrcDoc routes decks to the deck runtime", () => {
  assert.ok(buildSrcDoc("deck", DECK)!.includes("ld-root"));
  assert.ok(buildSrcDoc("deck", DECK, { view: "present" })!.includes('data-view="present"'));
  assert.equal(buildSrcDoc("code", "x"), null);
});

ok("swapping a wrapper attribute changes only that attribute", () => {
  const next = swapDeckAttr(DECK, "data-theme", "neon");
  assert.equal(readDeckAttr(next, "data-theme"), "neon");
  assert.equal(readDeckAttr(next, "data-size"), "fluid", "size untouched");
  assert.equal(
    next.replace('data-theme="neon"', 'data-theme="aurora"'),
    DECK,
    "nothing else in the markup moved"
  );
});

ok("an attribute that is missing gets added rather than ignored", () => {
  const bare = '<div class="deck">\n<section class="card"><h1>Hi</h1></section>\n</div>';
  assert.equal(readDeckAttr(bare, "data-theme"), null);
  assert.equal(readDeckAttr(swapDeckAttr(bare, "data-theme", "ink"), "data-theme"), "ink");
});

ok("markup with no wrapper is wrapped so it can still be styled", () => {
  const loose = '<section class="card"><h1>Hi</h1></section>';
  const wrapped = swapDeckAttr(loose, "data-theme", "paper");
  assert.equal(readDeckAttr(wrapped, "data-theme"), "paper");
  assert.ok(wrapped.includes('class="deck"'));
});

ok("themes are internally consistent", () => {
  const ids = new Set<string>();
  for (const t of DECK_THEMES) {
    assert.ok(!ids.has(t.id), `theme id ${t.id} is unique`);
    ids.add(t.id);
    assert.ok(t.colorKeywords && t.toneKeywords, `${t.id} has keywords for the model`);
    assert.ok(t.imageStyle, `${t.id} has an image style`);
    assert.ok(/^[0-9A-F]{6}$/.test(t.pptx.accent), `${t.id} has a flat accent for PPTX`);
    assert.ok(t.fonts.google.includes("family="), `${t.id} has a fonts query`);
  }
  assert.equal(findDeckTheme("nope").id, DECK_THEMES[0].id, "unknown id degrades to the default");
  assert.ok(deckThemeCss().includes("--accent"));
});

ok("every format has at least one size, and sizes are unique per format", () => {
  for (const f of DECK_FORMATS) {
    const sizes = DECK_SIZES[f];
    assert.ok(sizes && sizes.length, `${f} has sizes`);
    assert.equal(new Set(sizes.map((s) => s.id)).size, sizes.length, `${f} sizes unique`);
  }
});

ok("the prompt advertises exactly the themes and layouts that exist", () => {
  const directive = presentDirective({ images: false });
  for (const t of DECK_THEMES) assert.ok(directive.includes(t.id), `prompt lists ${t.id}`);
  for (const l of DECK_LAYOUTS) assert.ok(directive.includes(l.id), `prompt lists ${l.id}`);
  assert.ok(directive.includes("liberdeOutline"), "prompt asks for an outline first");
  assert.ok(directive.includes('type="deck"'), "prompt asks for the deck type");
  assert.ok(deckThemeTable().includes("aurora") && deckLayoutTable().includes("timeline"));
});

ok("the imagery branch follows whether an image model is available", () => {
  assert.ok(presentDirective({ images: true }).includes("generate_image"));
  assert.ok(!presentDirective({ images: false }).includes("call the generate_image tool"));
  assert.ok(presentDirective({ images: true, studio: true }).includes("Studio mode is ON"));
  assert.ok(!presentDirective({ images: true }).includes("Studio mode is ON"));
});

ok("outline blocks never survive into the readable transcript", () => {
  const text = 'Here is a plan.\n<liberdeOutline>{"title":"X","cards":[{"title":"A"}]}</liberdeOutline>\nDone.';
  const readable = readableAssistantText(text);
  assert.ok(!readable.includes("liberdeOutline"), "tag stripped");
  assert.ok(!readable.includes('"cards"'), "payload stripped");
  assert.ok(readable.includes("Here is a plan."), "surrounding prose kept");
});

const conv = createConversation("test/model");
try {
  ok("decks store, version and publish like any other artifact", () => {
    const msg = addMessage(
      conv.id,
      "assistant",
      `<liberdeArtifact identifier="deck" command="create" type="deck" title="Analytics">\n${DECK}\n</liberdeArtifact>`
    );
    processAssistantArtifacts(conv.id, msg.id, msg.content);
    const art = getArtifactByIdentifier(conv.id, "deck")!;
    assert.equal(art.type, "deck");
    const stored = getArtifactVersion(art.id)!.content;
    assert.ok(stored.includes('data-layout="stats"'));
    setArtifactShare(art.id, {
      share_id: "decktest",
      share_mode: "latest",
      pinned_version: null,
    });
    assert.equal(getArtifactByShareId("decktest")!.type, "deck");
  });

  ok("a theme swap is a one-attribute update the model can make surgically", () => {
    const art = getArtifactByIdentifier(conv.id, "deck")!;
    const before = getArtifactVersion(art.id)!.content;
    const msg = addMessage(
      conv.id,
      "assistant",
      `<liberdeArtifact identifier="deck" command="update">\n<liberdeOld>data-theme="aurora"</liberdeOld>\n<liberdeNew>data-theme="neon"</liberdeNew>\n</liberdeArtifact>`
    );
    processAssistantArtifacts(conv.id, msg.id, msg.content);
    const after = getArtifactVersion(art.id)!.content;
    assert.equal(readDeckAttr(after, "data-theme"), "neon");
    assert.equal(
      after.replace('data-theme="neon"', 'data-theme="aurora"'),
      before,
      "content is byte-identical apart from the theme"
    );
  });
} finally {
  deleteConversation(conv.id);
}

/**
 * The outline rescue. A weaker model answers the outline step by writing the
 * cards out as prose ("Card 1: …") instead of emitting the block, so nothing
 * renders and the deck is never built. Observed with mistralai/mistral-nemo on
 * 2026-09-15. The chat route detects that shape and forces one tools-off turn
 * to convert it; this mirrors the trigger so the threshold stays honest —
 * narrow enough not to hijack a prose answer, wide enough to catch the failure.
 */
const narratedOutline = (t: string) =>
  (t.match(/(?:^|\n)\s*(?:[#*->\s]*)(?:card|slide)\s*\d+\s*[:.–-]/gi) || []).length >= 3;

ok("the outline rescue fires on a prose outline", () => {
  assert.ok(narratedOutline("Here is the outline.\nCard 1: Title\nCard 2: Problem\nCard 3: Solution"));
  assert.ok(narratedOutline("**Card 1: Title**\n**Card 2: Problem**\n**Card 3: Solution**"));
  assert.ok(narratedOutline("- Slide 1 - Title\n- Slide 2 - Problem\n- Slide 3 - Solution"));
  assert.ok(narratedOutline("## Card 1: A\n## Card 2: B\n## Card 3: C\n## Card 4: D"));
});

/**
 * What a reply must look like by the time it reaches the transcript. Weak
 * models emit the outline payload with the wrapper tags missing and sometimes
 * stop mid-object; either way the user must never see raw JSON. Mirrors the
 * cleanup in ChatView's splitAsk. Both shapes observed 2026-09-15 with
 * mistralai/mistral-nemo.
 */
/** Everything splitAsk would hand to the markdown renderer, joined. */
const visibleText = (t: string) =>
  splitAsk(t)
    .map((p) => (p.type === "md" ? p.value : ""))
    .join("\n")
    .trim();

/**
 * The clarifying-question payload must never reach the markdown renderer.
 * An unterminated <liberdeAsk> with no prose around it used to fall through to
 * the fallback, which stripped the tag and printed the JSON — and because the
 * payload is a bracketed line containing braces, lib/math.ts then typeset the
 * whole thing as display LaTeX. Reported 2026-09-15 as a screen of run-together
 * italic serif where a question card should have been.
 */
const ASK_PAYLOAD =
  '[{"q":"Should this deck match an existing brand or reference?","options":["NiCE/enterprise technology style","Match reference I\'ll provide","Start fresh"],"multi":false},{"q":"Who is the primary audience?","options":["Execs","Product team"],"multi":false}]';

ok("an unterminated ask block still renders as questions, not JSON", () => {
  const parts = splitAsk("<liberdeAsk>" + ASK_PAYLOAD);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "ask");
  const asked = parts[0] as { type: "ask"; questions: { q: string }[] };
  assert.equal(asked.questions.length, 2);
  assert.ok(/existing brand/.test(asked.questions[0].q));
});

ok("a mangled ask payload degrades to the question text, never the payload", () => {
  const broken = '<liberdeAsk>[{"q":"What is the audience?","options":[oops';
  const parts = splitAsk(broken);
  const rendered = parts
    .map((p) => (p.type === "md" ? p.value : "[CARD]"))
    .join("\n");
  assert.ok(/What is the audience\?/.test(rendered), "the question survives");
  assert.ok(!/"options"|liberdeAsk|\{/.test(rendered), "no payload leaks: " + rendered);
});

ok("a leaked payload is no longer typeset as LaTeX", () => {
  // The bare-bracket display rule must not fire on JSON.
  assert.equal(normaliseMath(ASK_PAYLOAD), ASK_PAYLOAD);
  assert.ok(!normaliseMath(ASK_PAYLOAD).includes("$$"));
});

ok("real display maths is still recognised", () => {
  assert.ok(normaliseMath("[ \\frac{500000}{0.03} = 16666667 ]").includes("$$"));
  assert.ok(normaliseMath("[ x^2 + y^2 = z^2 ]").includes("$$"));
  assert.ok(normaliseMath("\\[ a + b \\]").includes("$$"));
  // And ordinary bracketed prose is still left alone.
  assert.equal(normaliseMath("[ see the appendix ]"), "[ see the appendix ]");
});

ok("an untagged outline payload never shows as raw JSON", () => {
  const truncated =
    'Here is the outline.\n{"title":"Northwind","settings":{"format":"presentation","cards":10},"cards":';
  assert.equal(visibleText(truncated), "Here is the outline.");
  const whole =
    '{"title":"N","settings":{"format":"presentation"},"cards":[{"title":"A","layout":"title"}]}';
  assert.equal(visibleText(whole), "");
});

ok("an unterminated tagged block is hidden while it streams", () => {
  assert.equal(visibleText('One moment.\n<liberdeOutline>{"title":"N","cards":'), "One moment.");
});

ok("ordinary prose is left completely alone", () => {
  const prose = 'A good deck runs 10 to 12 cards. I would put the "ask" last.';
  assert.equal(visibleText(prose), prose);
});

ok("the outline rescue leaves ordinary replies alone", () => {
  assert.ok(!narratedOutline("A good deck is 10 to 12 cards. Card 1 should be the title."));
  assert.ok(!narratedOutline("I can do that. Which theme would you like?"));
  // Two mentions are a passing reference, not an outline.
  assert.ok(!narratedOutline("Card 1: Title\nCard 2: Problem"));
});

console.log(`\n${passed} tests passed.`);
