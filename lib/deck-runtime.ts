// Deck runtime — the design engine behind Present mode (Liberde's Gamma clone).
//
// The model NEVER writes CSS or JS for a deck. It writes semantic card markup
// (<section class="card" data-layout="…">) plus a theme id, and everything you
// actually see — type scale, palette, spacing, smart layouts, charts, icons,
// present mode — comes from the constants in this file. That is the whole
// reason decks look consistent no matter which OpenRouter model produced them:
// design quality is our code's job, not the model's.
//
// Shared by three consumers, which is why it lives outside artifact-srcdoc.ts:
//   - lib/present-prompt.ts  (inlines the theme + layout tables into the prompt)
//   - lib/artifact-srcdoc.ts (buildDeckSrcDoc wraps card markup in CSS + JS)
//   - components/ArtifactPanel.tsx (theme picker, PPTX export colours/fonts)

export interface DeckTheme {
  id: string;
  label: string;
  /** Shown in pickers; also how the model reasons about fit. */
  mood: string;
  colorKeywords: string;
  toneKeywords: string;
  dark: boolean;
  tokens: {
    bg: string;
    surface: string;
    /** Optional gradient painted over `surface` (Gamma's gradient cards). */
    cardGradient?: string;
    ink: string;
    muted: string;
    accent: string;
    accent2: string;
    radius: string;
    shadow: string;
    stroke: string;
    headingWeight: number;
    headingTracking: string;
    kickerTransform: string;
  };
  fonts: {
    heading: string;
    body: string;
    /** families=… segment for the Google Fonts CSS2 endpoint. */
    google: string;
  };
  /** Appended to every generate_image prompt so a deck's art stays coherent. */
  imageStyle: string;
  /** Flat hex fallbacks for PPTX export, which cannot take gradients. */
  pptx: { bg: string; surface: string; ink: string; accent: string };
}

const SANS = "ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif";
const SERIF = "ui-serif,Georgia,Cambria,serif";

export const DECK_THEMES: DeckTheme[] = [
  {
    id: "slate",
    label: "Slate",
    mood: "Clean corporate, the safe default",
    colorKeywords: "white, blue, grey, light, professional, minimal, crisp",
    toneKeywords: "professional, trustworthy, clear, modern, neutral",
    dark: false,
    tokens: {
      bg: "#eef2f7",
      surface: "#ffffff",
      ink: "#0f172a",
      muted: "#64748b",
      accent: "#2563eb",
      accent2: "#0ea5e9",
      radius: "14px",
      shadow: "0 1px 2px rgba(15,23,42,.06), 0 12px 32px rgba(15,23,42,.08)",
      stroke: "1px solid rgba(15,23,42,.06)",
      headingWeight: 700,
      headingTracking: "-0.025em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Inter," + SANS,
      body: "Inter," + SANS,
      google: "family=Inter:wght@400;500;600;700;800",
    },
    imageStyle: "clean isometric vector illustration, blue and sky palette, white background, crisp",
    pptx: { bg: "EEF2F7", surface: "FFFFFF", ink: "0F172A", accent: "2563EB" },
  },
  {
    id: "aurora",
    label: "Aurora",
    mood: "Vibrant pastel gradients, startup energy",
    colorKeywords: "light, purple, blue, pink, pastel, gradient, vibrant, airy",
    toneKeywords: "playful, friendly, creative, inspirational, optimistic",
    dark: false,
    tokens: {
      bg: "linear-gradient(140deg,#f5f3ff 0%,#eef2ff 40%,#e0f2fe 100%)",
      surface: "rgba(255,255,255,.82)",
      cardGradient: "linear-gradient(135deg,rgba(124,58,237,.10),rgba(6,182,212,.10))",
      ink: "#1e1b4b",
      muted: "#6b6b8a",
      accent: "#7c3aed",
      accent2: "#06b6d4",
      radius: "22px",
      shadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 18px 50px rgba(76,29,149,.14)",
      stroke: "1px solid rgba(124,58,237,.16)",
      headingWeight: 700,
      headingTracking: "-0.03em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Sora," + SANS,
      body: "Inter," + SANS,
      google: "family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600",
    },
    imageStyle: "soft 3D render, pastel gradient lighting, glassmorphism, violet and cyan, dreamy",
    pptx: { bg: "F3F1FE", surface: "FFFFFF", ink: "1E1B4B", accent: "7C3AED" },
  },
  {
    id: "ink",
    label: "Ink",
    mood: "Editorial magazine, serif and hairlines",
    colorKeywords: "cream, black, orange, warm, serif, classic, editorial",
    toneKeywords: "authoritative, literary, considered, timeless",
    dark: false,
    tokens: {
      bg: "#f4f1ea",
      surface: "#fbfaf7",
      ink: "#141210",
      muted: "#6b6560",
      accent: "#c2410c",
      accent2: "#1f2937",
      radius: "4px",
      shadow: "0 1px 24px rgba(20,18,16,.07)",
      stroke: "1px solid rgba(20,18,16,.12)",
      headingWeight: 600,
      headingTracking: "-0.015em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Playfair Display," + SERIF,
      body: "Source Serif 4," + SERIF,
      google: "family=Playfair+Display:wght@500;600;700;800&family=Source+Serif+4:wght@400;600",
    },
    imageStyle: "black and white editorial photography, 35mm film grain, natural light, documentary",
    pptx: { bg: "F4F1EA", surface: "FBFAF7", ink: "141210", accent: "C2410C" },
  },
  {
    id: "paper",
    label: "Paper",
    mood: "Warm minimal, calm and uncluttered",
    colorKeywords: "beige, cream, brown, warm, calm, natural, soft",
    toneKeywords: "calm, human, thoughtful, understated, warm",
    dark: false,
    tokens: {
      bg: "#efe9de",
      surface: "#fffdf9",
      ink: "#2b2420",
      muted: "#7c6f66",
      accent: "#b45309",
      accent2: "#4b5563",
      radius: "18px",
      shadow: "none",
      stroke: "1px solid #e3d9c9",
      headingWeight: 400,
      headingTracking: "-0.01em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "DM Serif Display," + SERIF,
      body: "DM Sans," + SANS,
      google: "family=DM+Serif+Display&family=DM+Sans:wght@400;500;700",
    },
    imageStyle: "warm minimal flat illustration, muted earth tones, paper texture, hand-drawn feel",
    pptx: { bg: "EFE9DE", surface: "FFFDF9", ink: "2B2420", accent: "B45309" },
  },
  {
    id: "neon",
    label: "Neon",
    mood: "Dark tech, glow and contrast",
    colorKeywords: "dark, black, navy, cyan, purple, neon, futuristic, high contrast",
    toneKeywords: "bold, technical, energetic, cutting-edge",
    dark: true,
    tokens: {
      bg: "#070a12",
      surface: "#111827",
      cardGradient: "linear-gradient(160deg,rgba(34,211,238,.10),rgba(168,85,247,.10))",
      ink: "#e5e7eb",
      muted: "#94a3b8",
      accent: "#22d3ee",
      accent2: "#a855f7",
      radius: "16px",
      shadow: "0 0 0 1px rgba(148,163,184,.14), 0 24px 70px rgba(34,211,238,.13)",
      stroke: "1px solid rgba(148,163,184,.16)",
      headingWeight: 700,
      headingTracking: "-0.03em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Space Grotesk," + SANS,
      body: "Inter," + SANS,
      google: "family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600",
    },
    imageStyle: "neon cyberpunk 3D render, dark background, cyan and magenta rim light, volumetric",
    pptx: { bg: "070A12", surface: "111827", ink: "E5E7EB", accent: "22D3EE" },
  },
  {
    id: "consultant",
    label: "Consultant",
    mood: "Data-dense navy and gold, board-ready",
    colorKeywords: "navy, white, gold, corporate, serious, dense, consulting",
    toneKeywords: "authoritative, analytical, formal, precise",
    dark: false,
    tokens: {
      bg: "#e8edf4",
      surface: "#ffffff",
      ink: "#0b1f3a",
      muted: "#5b6b80",
      accent: "#0b3d91",
      accent2: "#c9a227",
      radius: "6px",
      shadow: "0 1px 3px rgba(11,31,58,.10)",
      stroke: "1px solid rgba(11,31,58,.14)",
      headingWeight: 600,
      headingTracking: "-0.015em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "IBM Plex Sans," + SANS,
      body: "IBM Plex Sans," + SANS,
      google: "family=IBM+Plex+Sans:wght@400;500;600;700",
    },
    imageStyle: "flat corporate infographic illustration, navy and gold, minimal, business abstract",
    pptx: { bg: "E8EDF4", surface: "FFFFFF", ink: "0B1F3A", accent: "0B3D91" },
  },
  {
    id: "midnight",
    label: "Midnight",
    mood: "Dark keynote, cinematic gradient",
    colorKeywords: "dark, navy, indigo, pink, blue, gradient, premium",
    toneKeywords: "dramatic, premium, confident, cinematic",
    dark: true,
    tokens: {
      bg: "linear-gradient(150deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%)",
      surface: "rgba(15,23,42,.72)",
      cardGradient: "linear-gradient(140deg,rgba(244,114,182,.10),rgba(96,165,250,.10))",
      ink: "#f1f5f9",
      muted: "#a5b4fc",
      accent: "#f472b6",
      accent2: "#60a5fa",
      radius: "20px",
      shadow: "0 0 0 1px rgba(148,163,184,.14), 0 26px 70px rgba(2,6,23,.55)",
      stroke: "1px solid rgba(165,180,252,.18)",
      headingWeight: 700,
      headingTracking: "-0.03em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Manrope," + SANS,
      body: "Manrope," + SANS,
      google: "family=Manrope:wght@400;500;600;700;800",
    },
    imageStyle: "cinematic dark 3D render, deep indigo and pink rim lighting, premium, moody",
    pptx: { bg: "141537", surface: "1B1E4A", ink: "F1F5F9", accent: "F472B6" },
  },
  {
    id: "forest",
    label: "Forest",
    mood: "Sage and gold, grounded and natural",
    colorKeywords: "green, sage, gold, natural, organic, earthy, calm",
    toneKeywords: "grounded, sustainable, honest, reassuring",
    dark: false,
    tokens: {
      bg: "#e4ece4",
      surface: "#f7fbf6",
      ink: "#14291d",
      muted: "#5b6f60",
      accent: "#2f855a",
      accent2: "#d69e2e",
      radius: "16px",
      shadow: "0 10px 30px rgba(20,41,29,.08)",
      stroke: "1px solid rgba(20,41,29,.10)",
      headingWeight: 600,
      headingTracking: "-0.02em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Fraunces," + SERIF,
      body: "Nunito Sans," + SANS,
      google:
        "family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700",
    },
    imageStyle: "botanical flat illustration, sage green and ochre, organic shapes, natural textures",
    pptx: { bg: "E4ECE4", surface: "F7FBF6", ink: "14291D", accent: "2F855A" },
  },
  {
    id: "coral",
    label: "Coral",
    mood: "Playful and rounded, consumer warmth",
    colorKeywords: "coral, orange, peach, warm, bright, playful, rounded",
    toneKeywords: "playful, approachable, energetic, fun, human",
    dark: false,
    tokens: {
      bg: "#ffeee9",
      surface: "#fffaf8",
      cardGradient: "linear-gradient(135deg,rgba(240,86,74,.07),rgba(255,179,71,.09))",
      ink: "#3b1f1a",
      muted: "#8a6a61",
      accent: "#f0564a",
      accent2: "#ffb347",
      radius: "30px",
      shadow: "0 14px 40px rgba(240,86,74,.16)",
      stroke: "1px solid rgba(240,86,74,.16)",
      headingWeight: 700,
      headingTracking: "-0.025em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Poppins," + SANS,
      body: "Poppins," + SANS,
      google: "family=Poppins:wght@400;500;600;700;800",
    },
    imageStyle: "playful flat vector illustration, coral and amber, rounded shapes, friendly characters",
    pptx: { bg: "FFEEE9", surface: "FFFAF8", ink: "3B1F1A", accent: "F0564A" },
  },
  {
    id: "mono",
    label: "Mono",
    mood: "Brutalist black and white, maximum contrast",
    colorKeywords: "black, white, monochrome, stark, brutalist, grid",
    toneKeywords: "direct, confident, uncompromising, modern",
    dark: false,
    tokens: {
      bg: "#e6e6e6",
      surface: "#ffffff",
      ink: "#000000",
      muted: "#6b6b6b",
      accent: "#000000",
      accent2: "#737373",
      radius: "0px",
      shadow: "6px 6px 0 #000000",
      stroke: "2px solid #000000",
      headingWeight: 900,
      headingTracking: "-0.04em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Archivo Black," + SANS,
      body: "Archivo," + SANS,
      google: "family=Archivo+Black&family=Archivo:wght@400;500;600;700",
    },
    imageStyle: "high contrast black and white graphic, halftone, bold geometric, no gradients",
    pptx: { bg: "E6E6E6", surface: "FFFFFF", ink: "000000", accent: "000000" },
  },
  {
    id: "sand",
    label: "Sand",
    mood: "Earthy and literary, desert tones",
    colorKeywords: "sand, tan, terracotta, olive, earthy, muted, vintage",
    toneKeywords: "crafted, considered, warm, artisanal",
    dark: false,
    tokens: {
      bg: "#e3d9c7",
      surface: "#f6f0e4",
      ink: "#3f2e1e",
      muted: "#857258",
      accent: "#a0522d",
      accent2: "#556b2f",
      radius: "10px",
      shadow: "0 8px 26px rgba(63,46,30,.10)",
      stroke: "1px solid rgba(63,46,30,.14)",
      headingWeight: 600,
      headingTracking: "-0.015em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Lora," + SERIF,
      body: "Karla," + SANS,
      google: "family=Lora:wght@500;600;700&family=Karla:wght@400;500;700",
    },
    imageStyle: "vintage risograph print, terracotta and olive, grainy texture, two-colour",
    pptx: { bg: "E3D9C7", surface: "F6F0E4", ink: "3F2E1E", accent: "A0522D" },
  },
  {
    id: "ocean",
    label: "Ocean",
    mood: "Fresh blue, open and optimistic",
    colorKeywords: "blue, teal, aqua, light, fresh, clean, open",
    toneKeywords: "optimistic, clear, welcoming, calm",
    dark: false,
    tokens: {
      bg: "#dcecf4",
      surface: "#f5fbfe",
      cardGradient: "linear-gradient(135deg,rgba(0,119,182,.06),rgba(0,180,216,.08))",
      ink: "#0c2d48",
      muted: "#5a7f96",
      accent: "#0077b6",
      accent2: "#00b4d8",
      radius: "18px",
      shadow: "0 12px 36px rgba(12,45,72,.10)",
      stroke: "1px solid rgba(12,45,72,.10)",
      headingWeight: 600,
      headingTracking: "-0.025em",
      kickerTransform: "uppercase",
    },
    fonts: {
      heading: "Outfit," + SANS,
      body: "Outfit," + SANS,
      google: "family=Outfit:wght@400;500;600;700;800",
    },
    imageStyle: "airy watercolour illustration, aqua and deep blue, light washes, generous white space",
    pptx: { bg: "DCECF4", surface: "F5FBFE", ink: "0C2D48", accent: "0077B6" },
  },
];

export const DEFAULT_DECK_THEME = "slate";

export const findDeckTheme = (id: string | null | undefined): DeckTheme =>
  DECK_THEMES.find((t) => t.id === id) ?? DECK_THEMES[0];

export interface DeckLayout {
  id: string;
  label: string;
  /** One-line guidance; inlined verbatim into the model's layout catalogue. */
  hint: string;
}

export const DECK_LAYOUTS: DeckLayout[] = [
  { id: "title", label: "Title", hint: "Opening card. kicker + h1 + lede, optional figure. Use once, first." },
  { id: "section", label: "Section divider", hint: "Chapter break. h1 + short lede; a big auto numeral is drawn for you." },
  { id: "text", label: "Text", hint: "h2 + one paragraph and/or up to 5 bullets. The plain workhorse." },
  { id: "bullets", label: "Icon bullets", hint: "h2 + ul where each li has data-icon. Best for 3-5 parallel points." },
  { id: "image-right", label: "Image right", hint: "h2 + text on the left, one figure on the right." },
  { id: "image-left", label: "Image left", hint: "Mirror of image-right; alternate them so the deck breathes." },
  { id: "image-top", label: "Image top", hint: "Wide figure above h2 + text. Good for screenshots." },
  { id: "image-bg", label: "Image background", hint: "Figure fills the card behind the text; add data-overlay=frosted|faded|clear." },
  { id: "stats", label: "Stats", hint: "h2 + 2-4 div.stat (b = the number, span = the label). Huge numerals." },
  { id: "columns-2", label: "Two columns", hint: "h2 + exactly 2 div.col, each with an h3 and a short paragraph or list." },
  { id: "columns-3", label: "Three columns", hint: "h2 + exactly 3 div.col. Keep each to about 20 words." },
  { id: "columns-4", label: "Four columns", hint: "h2 + exactly 4 div.col. Titles plus a few words each." },
  { id: "gallery", label: "Gallery", hint: "h2 + 2-6 figures in a grid, optional figcaption on each." },
  { id: "quote", label: "Quote", hint: "blockquote with a p and a cite. One idea, set large." },
  { id: "callout", label: "Callout", hint: "h2 + div.callout[data-kind=info|tip|warn|success] for one emphasised point." },
  { id: "table", label: "Table", hint: "h2 + one table with a thead. Max about 6 rows and 4 columns." },
  { id: "chart", label: "Chart", hint: "h2 + table[data-chart=bar|column|line|area|pie|donut|scatter|radar|stacked|hbar|gauge|waterfall]." },
  { id: "timeline", label: "Timeline", hint: "h2 + ol.steps; each li = b (date/label) + span (detail). Drawn as a rail." },
  { id: "process", label: "Process", hint: "h2 + ol.steps drawn as chevron arrows. 3-5 steps." },
  { id: "pyramid", label: "Pyramid", hint: "h2 + ol.steps, narrowest first. 3-5 levels, apex to base." },
  { id: "funnel", label: "Funnel", hint: "h2 + ol.steps, widest first. Conversion or filtering stories." },
  { id: "cycle", label: "Cycle", hint: "h2 + ol.steps arranged on a circle. 3-6 repeating stages." },
  { id: "staircase", label: "Staircase", hint: "h2 + ol.steps rising left to right. Maturity or growth stages." },
  { id: "versus", label: "Versus", hint: "h2 + exactly 2 div.col compared head to head; a VS badge is drawn." },
  { id: "quadrant", label: "Quadrant", hint: "h2 + exactly 4 div.col in a 2x2; label the axes with data-x and data-y on the card." },
  { id: "venn", label: "Venn", hint: "h2 + 2-3 div.col drawn as overlapping circles." },
  { id: "bullseye", label: "Bullseye", hint: "h2 + ol.steps as concentric rings, core first." },
  { id: "iceberg", label: "Iceberg", hint: "h2 + exactly 2 div.col: visible above the waterline, hidden below." },
  { id: "code", label: "Code", hint: "h2 + pre>code[class=language-x]. Highlighted for you." },
  { id: "embed", label: "Embed", hint: "h2 + figure.embed[data-src] for YouTube/Loom/Figma/Vimeo/CodePen." },
  { id: "studio", label: "Studio image", hint: "One generated full-bleed image that IS the card. Studio mode only." },
  { id: "closing", label: "Closing", hint: "Last card. h1 + lede, optional contact or CTA line. Mirrors the title card." },
];

export const DECK_FORMATS = ["presentation", "document", "webpage", "social"] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

export const DECK_SIZES: Record<DeckFormat, { id: string; label: string }[]> = {
  presentation: [
    { id: "fluid", label: "Fluid" },
    { id: "16x9", label: "16:9" },
    { id: "4x3", label: "4:3" },
  ],
  document: [
    { id: "fluid", label: "Fluid" },
    { id: "pageless", label: "Pageless" },
    { id: "letter", label: "Letter" },
    { id: "a4", label: "A4" },
  ],
  webpage: [{ id: "fluid", label: "Fluid" }],
  social: [
    { id: "1x1", label: "1:1" },
    { id: "4x5", label: "4:5" },
    { id: "9x16", label: "9:16" },
  ],
};

export const DECK_DENSITIES = [
  { id: "compact", label: "Compact" },
  { id: "medium", label: "Medium" },
  { id: "airy", label: "Airy" },
];

/** Per-theme CSS custom properties, emitted once into every deck document. */
export function deckThemeCss(): string {
  return DECK_THEMES.map((t) => {
    const k = t.tokens;
    const decl = [
      "--bg:" + k.bg,
      "--surface:" + k.surface,
      "--card-gradient:" + (k.cardGradient || "none"),
      "--ink:" + k.ink,
      "--muted:" + k.muted,
      "--accent:" + k.accent,
      "--accent-2:" + k.accent2,
      "--radius:" + k.radius,
      "--shadow:" + k.shadow,
      "--stroke:" + k.stroke,
      "--heading-weight:" + k.headingWeight,
      "--heading-tracking:" + k.headingTracking,
      "--kicker-transform:" + k.kickerTransform,
      "--heading-font:" + t.fonts.heading,
      "--body-font:" + t.fonts.body,
    ].join(";");
    const sel = 'html[data-theme="' + t.id + '"],.deck[data-theme="' + t.id + '"]';
    return sel + "{" + decl + "}";
  }).join("\n");
}

/** theme id -> Google Fonts query, handed to the runtime so it can swap live. */
export function deckFontMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of DECK_THEMES) out[t.id] = t.fonts.google;
  return out;
}

/**
 * Set one attribute on the deck wrapper without disturbing anything else.
 * Used by the panel's theme/density/size/format pickers, which edit the saved
 * markup directly — no model round-trip, so restyling is instant and free.
 */
export function swapDeckAttr(html: string, attr: string, value: string): string {
  const open = /<div\b[^>]*\bclass="[^"]*\bdeck\b[^"]*"[^>]*>/i.exec(html);
  if (!open) {
    // No wrapper (older or malformed deck): add one so the attribute has a home.
    return '<div class="deck" ' + attr + '="' + value + '">\n' + html + "\n</div>";
  }
  const tag = open[0];
  const re = new RegExp("\\s" + attr + '="[^"]*"', "i");
  const next = re.test(tag)
    ? tag.replace(re, " " + attr + '="' + value + '"')
    : tag.replace(/>$/, " " + attr + '="' + value + '">');
  return html.slice(0, open.index) + next + html.slice(open.index + tag.length);
}

/** Read one deck-wrapper attribute back out (for picker state). */
export function readDeckAttr(html: string, attr: string): string | null {
  const open = /<div\b[^>]*\bclass="[^"]*\bdeck\b[^"]*"[^>]*>/i.exec(html);
  if (!open) return null;
  const m = new RegExp("\\s" + attr + '="([^"]*)"', "i").exec(open[0]);
  return m ? m[1] : null;
}

/**
 * What each token means, for the extraction prompt that reads a brand off a
 * user's own deck. Lives here so the vocabulary offered to a model can never
 * drift from the vocabulary the stylesheet actually reads.
 */
export const TOKEN_REFERENCE = [
  "- bg: the page behind the cards (a flat colour or a linear-gradient)",
  "- surface: the card itself",
  "- card-gradient: an optional gradient painted over the card, or none",
  "- ink: body and heading text on the card",
  "- muted: secondary text, labels, the lede",
  "- accent: the brand colour that draws the eye — rules, numerals, icons, links",
  "- accent-2: the secondary, used for gradients and a second chart series",
  "- radius: card corner radius, e.g. 0px, 6px, 22px",
  "- shadow: a full CSS box-shadow value, or none",
  "- stroke: a full CSS border value for the card edge, or none",
  "- heading-weight: a numeric font weight, 400 to 900",
  "- heading-tracking: heading letter-spacing, e.g. -0.02em",
  "- kicker-transform: uppercase or none, for the small eyebrow label",
  "- heading-font: the heading family with fallbacks",
  "- body-font: the body family with fallbacks",
].join("\n");

/** Compact theme table inlined into the system prompt so the model can choose. */
export function deckThemeTable(): string {
  return DECK_THEMES.map(
    (t) => "- " + t.id + " — " + t.mood + ". colours: " + t.colorKeywords + ". tone: " + t.toneKeywords
  ).join("\n");
}

/** Compact layout table inlined into the system prompt. */
export function deckLayoutTable(): string {
  return DECK_LAYOUTS.map((l) => "- " + l.id + " — " + l.hint).join("\n");
}
