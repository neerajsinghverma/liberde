/**
 * Design systems: turning a saved brand into rules a model can follow, and
 * checking afterwards whether it did.
 *
 * The spec itself stays free text, because a brand is prose and forcing it into
 * a schema loses the half that matters ("warm, a little editorial, never
 * corporate"). What this module adds is the structured part that can be stated
 * exactly and verified afterwards: which colours are allowed, which fonts, and
 * how icons should look.
 *
 * Icons get their own section because they are the most common way a generated
 * page silently stops matching a brand. A model given no instruction reaches
 * for emoji or mixes three icon styles in one layout, and the result reads as
 * assembled rather than designed — the same failure the app itself had.
 */

/** A hex colour anywhere in a blob of text or CSS. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Normalise #abc and #AABBCCDD to a comparable #aabbcc. */
export function normaliseHex(hex: string): string {
  let h = hex.trim().toLowerCase().replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return "#" + h.slice(0, 6);
}

/** Every distinct colour a spec mentions, normalised. */
export function paletteOf(spec: string, palette?: string | null): string[] {
  const found = [...(spec + " " + (palette ?? "")).matchAll(HEX)].map((m) =>
    normaliseHex(m[0])
  );
  return [...new Set(found)];
}

/**
 * Font families a spec names.
 *
 * Matches the shapes people actually write — "Font: Inter", "Headings — Fraunces",
 * a bare Google Fonts URL — rather than requiring a particular syntax, because
 * the spec is written by a human or drafted by a model and neither is
 * consistent.
 */
export function fontsOf(spec: string): string[] {
  const out = new Set<string>();
  for (const m of spec.matchAll(/font-family\s*:\s*([^;{}<>\n]+)/gi)) {
    let value = m[1];
    const quotes = (value.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) value = value.slice(0, value.lastIndexOf("\""));
    for (const part of value.split(",")) {
      const name = part.replace(/["']/g, "").trim();
      if (name && !/^(sans-serif|serif|monospace|system-ui|ui-[a-z-]+|inherit)$/i.test(name)) {
        out.add(name);
      }
    }
  }
  for (const m of spec.matchAll(/fonts\.googleapis\.com\/css2\?family=([A-Za-z0-9+]+)/g)) {
    out.add(m[1].replace(/\+/g, " "));
  }
  for (const m of spec.matchAll(
    /^\s*(?:[-*]\s*)?(?:heading|body|display|mono|font)s?\s*[:—]\s*([A-Z][A-Za-z0-9 ]{1,30})/gim
  )) {
    out.add(m[1].trim());
  }
  return [...out];
}

/** How icons should look. Free text, but with a stated default. */
export interface IconStyle {
  /** "line", "solid", "duotone" — whatever the spec says, lowercased. */
  style: string;
  /** Stroke width for line icons, as a CSS number. */
  stroke: string;
  /** A named set the spec asks for, if any. */
  set: string;
}

const DEFAULT_ICONS: IconStyle = { style: "line", stroke: "1.75", set: "" };

export function iconStyleOf(spec: string): IconStyle {
  const style =
    spec.match(/\b(line|outline|stroked|solid|filled|duotone)\b\s*icons?/i)?.[1] ??
    spec.match(/icons?\s*[:—]?\s*\b(line|outline|stroked|solid|filled|duotone)\b/i)?.[1] ??
    "";
  const stroke = spec.match(/stroke[- ]?width\s*[:=]?\s*([0-9.]+)/i)?.[1] ?? "";
  const set =
    spec.match(/\b(lucide|feather|heroicons|phosphor|material symbols|tabler|remix ?icon)\b/i)?.[1] ??
    "";
  return {
    style: (style || DEFAULT_ICONS.style).toLowerCase().replace("outline", "line").replace("stroked", "line").replace("filled", "solid"),
    stroke: stroke || DEFAULT_ICONS.stroke,
    set,
  };
}

/**
 * The instruction block for a locked design system.
 *
 * Deliberately more prescriptive than "follow this system". Everything a model
 * can get wrong quietly is stated as a rule with a concrete mechanism: declare
 * the palette as custom properties so drift is visible in one place, load fonts
 * from one link, draw icons one way. The closing rule matters most — a model
 * asked to improvise an icon reaches for an emoji, and one emoji is enough to
 * make an otherwise on-brand page look assembled.
 */
export function designSystemBlock(ds: {
  name: string;
  spec: string;
  palette?: string | null;
}): string {
  const colours = paletteOf(ds.spec, ds.palette);
  const fonts = fontsOf(ds.spec);
  const icons = iconStyleOf(ds.spec);

  const rules = [
    "# Active design system: " + ds.name,
    "",
    "Every artifact in this conversation MUST follow it. Rules, in order of how often they are broken:",
    "",
    "1. COLOUR. Declare the palette as CSS custom properties in :root and reference them everywhere. Do not introduce a colour that is not in the system, including for borders, shadows and hover states." +
      (colours.length ? " The palette is: " + colours.join(", ") + "." : ""),
    "2. TYPE. Load the system fonts with a single Google Fonts link and set them once on the body." +
      (fonts.length ? " The fonts are: " + fonts.join(", ") + "." : "") +
      " Do not mix in a third family for accents.",
    "3. ICONS. Use " +
      icons.style +
      " icons only, at a consistent size, with stroke-width " +
      icons.stroke +
      (icons.set ? ", in the style of " + icons.set : "") +
      ". Draw them as inline SVG using currentColor so they inherit the palette. Never use emoji as an icon: an emoji renders as a filled colour glyph in the system font and will not match anything else on the page.",
    "4. SPACING. Follow the system spacing rhythm rather than ad-hoc pixel values.",
    "5. COMPONENTS. Reuse the component styles the system defines instead of inventing a second button or card.",
    "",
    "When asking clarifying questions, skip anything the system already answers — colours, fonts, icon style, overall feel. Before you finish, re-read the artifact against these five rules and fix the drift you find. If the user explicitly asks to deviate, the user wins.",
    "",
    ds.spec,
  ];
  return rules.join("\n");
}

export interface Conformance {
  /** Colours used by the artifact that the system does not define. */
  strayColours: string[];
  /** Font families used that the system does not name. */
  strayFonts: string[];
  /** Emoji found where an icon belongs. */
  emojiCount: number;
}

/**
 * Check a finished artifact against its system.
 *
 * Reports drift rather than blocking: the check is textual, so a colour inside
 * a code sample or a legitimately quoted brand would both look like violations,
 * and a hard gate on a heuristic would be worse than the drift it prevents. The
 * point is to tell someone which three colours crept in, not to be right about
 * every one.
 */
export function checkConformance(
  artifact: string,
  ds: { spec: string; palette?: string | null }
): Conformance {
  const allowed = new Set(paletteOf(ds.spec, ds.palette));
  const used = new Set([...artifact.matchAll(HEX)].map((m) => normaliseHex(m[0])));
  // Greys and pure black/white are how every page does borders and text; they
  // are not what "off-brand" means and flagging them would bury the real ones.
  const neutral = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12;
  };
  const strayColours = [...used].filter((c) => !allowed.has(c) && !neutral(c));

  const named = new Set(fontsOf(ds.spec).map((f) => f.toLowerCase()));
  const strayFonts = fontsOf(artifact).filter((f) => !named.has(f.toLowerCase()));

  const emoji = artifact.match(/[\u{1F300}-\u{1FAFF}]/gu);
  return {
    strayColours,
    strayFonts: [...new Set(strayFonts)],
    emojiCount: emoji ? emoji.length : 0,
  };
}
