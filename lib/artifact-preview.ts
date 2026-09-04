/**
 * Card previews for the artifacts gallery.
 *
 * A gallery card has to answer "which one is this" at a glance. Slicing the
 * first few hundred characters of the source does the opposite: an HTML
 * artifact begins with a doctype and a stylesheet, a React one with an import
 * block, and every card ends up showing the same wall of custom properties and
 * icon names. Identical noise is worse than no preview at all, because it costs
 * the same space and carries none of the signal.
 *
 * So this extracts meaning instead: the headings and prose a person would use
 * to describe the thing, plus a few colours from its palette to give each card
 * a visual identity that a monochrome text block cannot.
 */

export interface ArtifactPreview {
  /** A short human description, or empty when nothing readable was found. */
  text: string;
  /** Up to five palette colours, for the card's accent strip. */
  colors: string[];
}

/** How much source to read. Enough to reach the body of a styled document. */
export const PREVIEW_SOURCE_CHARS = 6000;
const MAX_TEXT = 200;

/**
 * Remove a paired block even when the closing tag is past the end of the slice.
 *
 * This is the case that broke the first version: previews are truncated, so a
 * <style> opens and never closes, the paired-tag pattern fails to match, and
 * the entire stylesheet survives into the card.
 */
function stripBlock(text: string, tag: string): string {
  const open = new RegExp("<" + tag + "[^>]*>", "i");
  let out = text;
  for (;;) {
    const start = out.search(open);
    if (start === -1) return out;
    const closeAt = out.toLowerCase().indexOf("</" + tag, start);
    if (closeAt === -1) return out.slice(0, start);
    out = out.slice(0, start) + " " + out.slice(closeAt + tag.length + 3);
  }
}

/** Colours the artifact actually declares, in the order it declares them. */
function paletteFrom(source: string): string[] {
  const seen: string[] = [];
  for (const m of source.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toLowerCase();
    // Near-neutrals are every page's borders and text; they say nothing about
    // which artifact this is, which is the only job the strip has.
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 18) continue;
    if (!seen.includes(hex)) seen.push(hex);
    if (seen.length === 5) break;
  }
  return seen;
}

/** Visible text from a markup document: headings first, then body prose. */
function textFromMarkup(source: string): string {
  let s = stripBlock(source, "style");
  s = stripBlock(s, "script");
  s = stripBlock(s, "svg");
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, " ");

  const parts: string[] = [];
  const title = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) parts.push(title);
  for (const m of s.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    parts.push(m[1]);
    if (parts.length > 4) break;
  }
  for (const m of s.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    parts.push(m[1]);
    if (parts.length > 6) break;
  }
  // Nothing structural found — fall back to whatever text is left between tags.
  if (parts.length === 0) parts.push(s.replace(/<[^>]*>/g, " "));
  return parts.join(" — ").replace(/<[^>]*>/g, " ");
}

/**
 * Readable text from React or plain source: the strings a human wrote.
 *
 * Import blocks span lines and are the bulk of what a truncated React file
 * contains, which is why a whole row of cards showed nothing but icon names.
 */
function textFromCode(source: string): string {
  let s = source
    .replace(/import[\s\S]*?from\s*["'][^"']*["'];?/g, " ")
    .replace(/^\s*(?:export\s+)?(?:const|let|var|function|class)\b[^\n]*$/gm, " ")
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
    .replace(/^\s*\/\/[^\n]*$/gm, " ");
  // Prefer JSX text and quoted strings of a sentence-like length.
  const words: string[] = [];
  for (const m of s.matchAll(/>([^<>{}\n]{6,})</g)) words.push(m[1]);
  if (words.length === 0) {
    for (const m of s.matchAll(/["']([^"'\n]{12,})["']/g)) words.push(m[1]);
  }
  return words.length ? words.join(" — ") : s.replace(/[{}<>();]/g, " ");
}

/** Markdown, minus the syntax that carries no meaning on a card. */
function textFromMarkdown(source: string): string {
  return source
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, " ")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>|]/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** Build the card preview for one artifact. */
export function artifactPreview(source: string, type: string): ArtifactPreview {
  const src = (source ?? "").slice(0, PREVIEW_SOURCE_CHARS);
  if (!src.trim()) return { text: "", colors: [] };

  let text: string;
  if (type === "html" || type === "svg" || type === "slides" || type === "mermaid") {
    text = textFromMarkup(src);
  } else if (type === "react" || type === "code") {
    text = textFromCode(src);
  } else {
    text = textFromMarkdown(src);
  }

  text = text
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A preview made mostly of punctuation and hex is the failure this module
  // exists to prevent, so it is discarded rather than shown.
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (letters < 12 || letters / Math.max(text.length, 1) < 0.4) text = "";

  return { text: text.slice(0, MAX_TEXT), colors: paletteFrom(src) };
}
