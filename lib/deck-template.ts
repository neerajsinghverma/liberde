// Present templates: bringing your own brand into the deck engine.
//
// A template is the same shape as a built-in theme, except a person supplied it
// instead of us — extracted from screenshots of a real deck, read out of a brand
// guidelines document, or saved from a Liberde deck you had already got right.
// It can also carry its own layouts, copied from the template's actual slide
// designs, for when a brand skin over our layouts is not close enough.
//
// Everything here is pure and defensive, for one reason: these values come from
// a model reading a customer's PDF, and they are then interpolated straight into
// a <style> block. So every property name is whitelisted and every value is
// validated. A template that arrives malformed loses the offending declaration
// rather than emitting broken or hostile CSS.

/** A layout the template defines itself, on top of the thirty built-in ones. */
export interface DeckTemplateLayout {
  /** Always prefixed "custom-" so it can never shadow a built-in layout. */
  id: string;
  label: string;
  /** One line telling the model when to reach for it. */
  hint: string;
}

export interface DeckTemplate {
  id: string;
  user_id: string;
  name: string;
  source: "screenshots" | "deck" | "brand-doc" | "manual";
  /** Deck CSS custom properties, without the leading dashes. */
  tokens: Record<string, string>;
  /** families=… segment for the Google Fonts endpoint, when the fonts are web fonts. */
  fonts_query: string | null;
  /** Appended to every generate_image prompt so artwork matches the brand. */
  image_style: string | null;
  logo: string | null;
  logo_pos: string | null;
  /** CSS defining the custom-* layouts below. Sanitised before it is emitted. */
  layout_css: string | null;
  layouts: DeckTemplateLayout[];
  /** Free text for the model: voice, imagery, things to avoid. */
  notes: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * The only custom properties a template may set. Deliberately exactly the deck
 * runtime's own token vocabulary: a template can restyle a deck completely, and
 * can introduce nothing the stylesheet does not already understand.
 */
export const TEMPLATE_TOKENS = [
  "bg",
  "surface",
  "card-gradient",
  "ink",
  "muted",
  "accent",
  "accent-2",
  "radius",
  "shadow",
  "stroke",
  "heading-weight",
  "heading-tracking",
  "kicker-transform",
  "heading-font",
  "body-font",
] as const;

export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

/**
 * Reject a CSS value that could break out of the declaration it sits in.
 *
 * The deck renders in a sandboxed frame with no same-origin access, so the worst
 * case here is a defaced deck rather than stolen data. It is still worth being
 * strict: a stray brace or semicolon from a model's mis-read of a PDF would
 * corrupt every rule after it, and the failure would look like the whole theme
 * silently not applying.
 */
// No url() in a token, at all. A data URI legitimately contains a semicolon,
// and a semicolon in a single declaration value is exactly the thing that
// corrupts every rule after it — so rather than trying to tell the two apart,
// tokens carry colour and geometry only. Images reach a deck through the logo
// field, which is validated separately, and through figures in the markup.
const FORBIDDEN_VALUE = /[{}<>;]|\/\*|\*\/|@import|expression\s*\(|url\s*\(/i;

export function sanitiseTokenValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v || v.length > 300) return null;
  if (FORBIDDEN_VALUE.test(v)) return null;
  return v;
}

/** Keep only known tokens with safe values. Anything else is dropped. */
export function sanitiseTokens(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of TEMPLATE_TOKENS) {
    const value = sanitiseTokenValue((raw as Record<string, unknown>)[key]);
    if (value) out[key] = value;
  }
  return out;
}

const SAFE_LAYOUT_ID = /^custom-[a-z0-9-]{1,40}$/;

/** Normalise a layout list, forcing the custom- prefix and dropping the rest. */
export function sanitiseLayouts(raw: unknown): DeckTemplateLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DeckTemplateLayout[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const l = item as Partial<DeckTemplateLayout>;
    if (typeof l.id !== "string") continue;
    let id = l.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      // Punctuation in a name ("Hero!!") would otherwise leave trailing dashes
      // in an id the model has to type back exactly.
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id.startsWith("custom-")) id = "custom-" + id;
    if (id === "custom-") continue;
    if (!SAFE_LAYOUT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(l.label ?? id.replace("custom-", "")).slice(0, 60),
      hint: String(l.hint ?? "").slice(0, 200),
    });
  }
  return out;
}

/**
 * Sanitise the CSS a template brings for its own layouts.
 *
 * Every selector must be scoped to one of the template's own custom layouts, so
 * a template can never restyle a built-in layout or the app's chrome. Rules that
 * do not scope that way are dropped, which degrades to "that layout looks plain"
 * rather than to a deck with its controls hidden.
 */
export function sanitiseLayoutCss(raw: unknown, layouts: DeckTemplateLayout[]): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const allowed = new Set(layouts.map((l) => l.id));
  if (!allowed.size) return null;
  const css = raw.slice(0, 20_000);
  if (/@import|javascript:|expression\s*\(/i.test(css)) return null;

  const kept: string[] = [];
  // One flat pass over top-level rules. Nested at-rules are not supported on
  // purpose: a template needs colours and composition, not media queries, and
  // allowing them would mean parsing CSS properly.
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css))) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;
    if (selector.startsWith("@")) continue;
    if (/[<>]/.test(selector)) continue;
    // A url() may only reach an inline image or https. Anything else in a rule
    // that came out of a model reading a PDF is a mistake, not a feature.
    if (/url\s*\(/i.test(body) && !/url\s*\(\s*["']?(data:image\/|https:\/\/)/i.test(body)) {
      continue;
    }
    const scoped = selector.split(",").every((part) => {
      const s = part.trim();
      return [...allowed].some((id) => s.includes('data-layout="' + id + '"'));
    });
    if (!scoped) continue;
    if (/expression\s*\(|javascript:/i.test(body)) continue;
    kept.push(selector + "{" + body + "}");
  }
  return kept.length ? kept.join("\n") : null;
}

const SAFE_LOGO = /^(data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"'<>]+|\/img\/[\w-]+)$/;
const LOGO_POS = new Set(["tl", "tr", "bl", "br", "tc", "bc"]);

export function sanitiseLogo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 2_000_000) return null;
  return SAFE_LOGO.test(v) ? v : null;
}

export function sanitiseLogoPos(raw: unknown): string | null {
  return typeof raw === "string" && LOGO_POS.has(raw) ? raw : null;
}

/** A fonts query is only ever a families list for the Google Fonts endpoint. */
export function sanitiseFontsQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 400) return null;
  return /^[A-Za-z0-9@:;,.+&=\s_-]+$/.test(v) && v.includes("family=") ? v : null;
}

/**
 * The CSS a template contributes to a deck document: its tokens under the
 * "custom" theme id, plus its own layout rules. Emitted by buildDeckSrcDoc, so
 * a published or downloaded deck carries its brand with it.
 */
export function templateCss(t: Pick<DeckTemplate, "tokens" | "layout_css">): string {
  const decl = Object.entries(t.tokens)
    .map(([k, v]) => "--" + k + ":" + v)
    .join(";");
  const out: string[] = [];
  if (decl) {
    out.push('html[data-theme="custom"],.deck[data-theme="custom"]{' + decl + "}");
  }
  if (t.layout_css) out.push(t.layout_css);
  return out.join("\n");
}

/**
 * A flat six-digit hex for PowerPoint, which cannot take a gradient, an rgba or
 * a colour function. Picks the first hex in the value, so a gradient collapses
 * to its first stop, and falls back when there is nothing usable.
 */
export function flatHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const m = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(value);
  if (!m) return fallback;
  const h = m[1];
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return full.toUpperCase();
}

/** The four colours a PowerPoint export needs, taken from a template. */
export function templatePptxPalette(
  t: Pick<DeckTemplate, "tokens">,
  fallback: { bg: string; surface: string; ink: string; accent: string }
) {
  return {
    bg: flatHex(t.tokens.bg, fallback.bg),
    surface: flatHex(t.tokens.surface, fallback.surface),
    ink: flatHex(t.tokens.ink, fallback.ink),
    accent: flatHex(t.tokens.accent, fallback.accent),
  };
}

/**
 * What the model is told about an active template. Kept short and concrete: the
 * tokens themselves are none of its business, because it never writes CSS — it
 * only needs the theme id to set, the layouts it may now use, and the brand's
 * voice and image direction.
 */
export function templatePromptBlock(
  t: Pick<DeckTemplate, "id" | "name" | "image_style" | "layouts" | "notes" | "logo" | "logo_pos">,
  mode: "skin" | "layouts"
): string {
  const lines: string[] = [
    "# Active template: " + t.name,
    "",
    'This deck uses the user\'s own template. Put BOTH of these on the deck wrapper: data-theme="custom" and data-template="' +
      t.id +
      '". The second is how the interface finds the template again when it renders, exports or publishes the deck, so a deck missing it silently loses the brand. The colours, fonts, radius and shadow all come from the template automatically, and you must still not write any CSS.',
  ];
  if (t.logo) {
    lines.push(
      'The template has a logo. Put it in a running corner with data-hf-' +
        (t.logo_pos || "br") +
        '="logo:' +
        t.logo +
        '" on the deck wrapper, and add data-hf-hide-first so it stays off the title card.'
    );
  }
  if (t.image_style) {
    lines.push(
      "For any generate_image call, end the prompt with this template's image style instead of a built-in theme's: " +
        t.image_style
    );
  }
  if (mode === "layouts" && t.layouts.length) {
    lines.push(
      "",
      "The template contributes these layouts, copied from its real slide designs. Prefer them over the built-in ones wherever the content fits, because they are what makes a deck recognisably this brand:",
      ...t.layouts.map((l) => "- " + l.id + " — " + l.hint)
    );
  } else if (t.layouts.length) {
    lines.push(
      "",
      "The template also defines its own layouts, but this deck is using the brand skin only. Stick to the built-in layouts."
    );
  }
  if (t.notes) lines.push("", "Brand notes from the user:", t.notes);
  return lines.join("\n");
}
