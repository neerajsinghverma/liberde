// Wraps the model's deck markup in the runtime that makes it a real document:
// theme tokens, the stylesheet, chrome (controls, progress, notes, presenter
// pane) and the script. Kept apart from artifact-srcdoc.ts only because the
// deck engine is large enough to deserve its own file.

import { DECK_CSS } from "./deck-styles";
import { DECK_JS } from "./deck-script";
import { deckFontMap, deckThemeCss } from "./deck-runtime";

// Deliberately NO error overlay here, unlike every other artifact type.
//
// A deck contains no model-authored script, so the only code that can throw is
// ours — and offering "Fix with AI" for our own runtime sends the user to a
// model that cannot fix it. The one failure a deck really does hit is a missing
// image, which the runtime already handles by painting an on-theme graphic
// instead; surfacing that as "this artifact threw an error" told the user
// something was broken at the exact moment it had recovered.

export interface DeckDocOptions {
  /** Which view the document opens in. Present/presenter are used by the
   *  full-screen tabs the panel opens; the inline preview stays on "scroll". */
  view?: "scroll" | "present" | "presenter";
  /** Endpoint for per-card dwell beacons; only set for published /live pages. */
  beacon?: string;
}

const CHROME = `
<div id="ld-progress"></div>
<div id="ld-ctl" role="toolbar" aria-label="Deck controls">
  <button id="ld-prev" title="Previous card (left arrow)" aria-label="Previous card">&#8249;</button>
  <span id="ld-count"></span>
  <button id="ld-next" title="Next card (right arrow or space)" aria-label="Next card">&#8250;</button>
  <button id="ld-present" title="Present (P)" aria-pressed="false" aria-label="Present">&#9654;</button>
  <button id="ld-spot" title="Spotlight one block at a time (S)" aria-pressed="false" aria-label="Spotlight">&#9673;</button>
  <button id="ld-notesbtn" title="Speaker notes (N)" aria-pressed="false" aria-label="Speaker notes">&#9998;</button>
  <button id="ld-print" title="Print or save as PDF" aria-label="Print">&#9113;</button>
</div>
<div id="ld-notes">
  <div id="ld-notes-head">Speaker notes &middot; card <span id="ld-notes-n"></span> &mdash; saved with the deck</div>
  <textarea id="ld-notes-text" placeholder="What you would say on this card. Hidden from the audience; exported as PowerPoint presenter notes."></textarea>
</div>
<div id="ld-toast" role="status"></div>
<div id="ld-presenter">
  <div id="ld-pv-head">
    <span id="ld-pv-timer">00:00</span>
    <button id="ld-pv-reset" type="button">Reset timer</button>
    <span id="ld-pv-count"></span>
    <span style="opacity:.6;font-weight:400">Drive the deck from the presentation window</span>
  </div>
  <div id="ld-pv-stage"><div id="ld-pv-label">Now</div></div>
  <div id="ld-pv-next"><div id="ld-pv-label">Next</div></div>
  <div id="ld-pv-notes"></div>
</div>`;

export function buildDeckSrcDoc(content: string, opts: DeckDocOptions = {}): string {
  const view = opts.view || "scroll";
  const globals =
    "var LD_FONTS=" +
    JSON.stringify(deckFontMap()).replace(/</g, "\\u003c") +
    ";var LD_VIEW=" +
    JSON.stringify(view) +
    ";" +
    (opts.beacon ? "var LD_BEACON=" + JSON.stringify(opts.beacon) + ";" : "");

  return (
    `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>${deckThemeCss()}</style>
<style>${DECK_CSS}</style>
</head><body data-view="${view}">
<div id="ld-root">${content}</div>` +
    CHROME +
    `<script>${globals}</script><script>${DECK_JS}</script></body></html>`
  );
}
