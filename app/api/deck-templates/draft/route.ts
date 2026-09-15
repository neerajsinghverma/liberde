import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { bodyTooLarge } from "@/lib/limits";
import { complete, getSettings, type ChatCompletionMessage } from "@/lib/openrouter";
import { DECK_LAYOUTS, TOKEN_REFERENCE } from "@/lib/deck-runtime";
import {
  sanitiseFontsQuery,
  sanitiseLayoutCss,
  sanitiseLayouts,
  sanitiseTokens,
} from "@/lib/deck-template";

export const runtime = "nodejs";

/**
 * Read a brand out of what the user actually has: screenshots or rendered PDF
 * pages of a deck they already use, or the text of a brand guidelines document.
 *
 * Two things make this worth doing with a model rather than a colour sampler.
 * A sampler cannot tell the accent from the background, and it cannot tell you
 * that the headings are set in a condensed sans while the body is a serif. The
 * model is asked for exactly the token vocabulary the deck runtime understands,
 * so whatever comes back either applies cleanly or is dropped by the sanitiser.
 *
 * Nothing is saved here. The draft goes back to the UI for the user to look at
 * and correct, because an extracted brand is a guess until someone confirms it.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;

  const { images, text, prompt, withLayouts, model } = await req.json().catch(() => ({}));
  const imageUrls: string[] = Array.isArray(images)
    ? images
        .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("data:image/"))
        .slice(0, 6)
    : [];
  const docText = typeof text === "string" ? text.slice(0, 40_000) : "";

  if (!imageUrls.length && !docText.trim() && !String(prompt ?? "").trim()) {
    return Response.json(
      { error: "Attach slide images, paste the brand document, or describe the brand" },
      { status: 400 }
    );
  }

  const wantLayouts = withLayouts === true && imageUrls.length > 0;

  const sys = `You extract a presentation template from what a user already has, for a deck engine whose entire visual vocabulary is the token list below. You never write a stylesheet; you report values.

## The tokens you may set
${TOKEN_REFERENCE}

Rules that matter:
- Colours as hex. "bg" is the page behind the cards and "surface" is the card itself; on a dark brand both are dark and "ink" is light. Get this pair right before anything else, because every card sits on it.
- "accent" is the colour the brand uses to draw the eye (a rule, a numeral, a highlight), NOT the background. "accent-2" is the secondary, used for gradients and second chart series. If the brand has only one colour, make accent-2 a darker or lighter version of it rather than inventing a new hue.
- Fonts: give real families. Name a Google Font where the brand's face is one, or where a close substitute exists, and say so in notes. Include the matching "fontsQuery" as a Google Fonts families query, e.g. "family=Inter:wght@400;600;700&family=Lora:wght@500".
- "radius" and "shadow" carry a lot of the feel. A brand with square corners and no shadow must get radius 0px and shadow none.
- "imageStyle" is a short phrase appended to every image-generation prompt so artwork matches the deck. Describe medium and palette, e.g. "flat vector illustration, navy and warm grey, generous white space".
${
  wantLayouts
    ? `
## Layouts
Also copy the specific slide compositions you can see. For each distinctive one, give an id starting "custom-", a label, a one-line hint on when to use it, and CSS.

The CSS rules:
- Every selector MUST be scoped as .card[data-layout="custom-yourid"] or a descendant of it. A rule that is not will be discarded.
- Style composition only: grid/flex placement, alignment, sizes, borders, pseudo-element accents. Use var(--accent), var(--ink), var(--surface) and the other tokens rather than repeating hex values, so the layout follows the theme.
- The children available inside a card are: p.kicker, h1, h2, h3, p, p.lede, ul, ol, figure, div.stat (with b and span), ol.steps (li with b and span), blockquote (p and cite), div.col, div.callout, table, pre.
- No @media, no @import, no url() except a data: or https: image.
Keep it to at most 5 layouts and the composition that makes the brand recognisable, not every detail.`
    : ""
}

Reply with ONLY minified JSON and nothing else:
{"name":"...","tokens":{"bg":"#...","surface":"#...","ink":"#...","muted":"#...","accent":"#...","accent-2":"#...","radius":"...","shadow":"...","stroke":"...","heading-font":"...","body-font":"...","heading-weight":700,"heading-tracking":"-0.02em","kicker-transform":"uppercase"},"fontsQuery":"family=...","imageStyle":"...","notes":"voice and imagery direction, plus anything you had to substitute"${
    wantLayouts ? ',"layouts":[{"id":"custom-...","label":"...","hint":"..."}],"layoutCss":"..."' : ""
  }}`;

  const parts: { type: string; text?: string; image_url?: { url: string } }[] = [];
  if (String(prompt ?? "").trim()) {
    parts.push({ type: "text", text: "What the user says about the brand:\n" + String(prompt).trim() });
  }
  if (docText.trim()) {
    parts.push({
      type: "text",
      text:
        "Brand document text. Values stated here are authoritative — prefer them over anything you infer:\n\n" +
        docText,
    });
  }
  if (imageUrls.length) {
    parts.push({
      type: "text",
      text:
        "Slides from the deck to match. Read the palette, the typefaces, the corner radius and the shadow off these.",
    });
    for (const url of imageUrls) parts.push({ type: "image_url", image_url: { url } });
  }

  const messages = [
    { role: "system", content: sys },
    { role: "user", content: parts },
  ] as unknown as ChatCompletionMessage[];

  const settings = await getSettings(userId);
  // The default model, not the cheap title model: reading a palette and a pair
  // of typefaces off a screenshot is a vision job, and getting it wrong wastes
  // far more of the user's time than the few tenths of a cent saved.
  let raw: string;
  try {
    raw = await complete(
      model || settings.defaultModel,
      messages,
      { temperature: 0.2, max_tokens: wantLayouts ? 4000 : 1500, timeoutMs: 90_000 },
      userId
    );
  } catch (e) {
    return Response.json({ error: `Extraction failed: ${e}` }, { status: 502 });
  }

  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  } catch {
    return Response.json(
      { error: "The model did not return a readable template. Try a stronger model." },
      { status: 502 }
    );
  }

  // Sanitise before it ever leaves the server, so the preview the user confirms
  // is exactly what would be saved.
  const layouts = sanitiseLayouts(parsed.layouts);
  const draft = {
    name: String(parsed.name ?? "Untitled template").slice(0, 80),
    tokens: sanitiseTokens(parsed.tokens),
    fontsQuery: sanitiseFontsQuery(parsed.fontsQuery),
    imageStyle:
      typeof parsed.imageStyle === "string" ? parsed.imageStyle.trim().slice(0, 400) : null,
    notes: typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 2000) : null,
    layouts,
    layoutCss: sanitiseLayoutCss(parsed.layoutCss, layouts),
    /** So the UI can say which built-in layouts remain available alongside. */
    builtInLayoutCount: DECK_LAYOUTS.length,
  };
  if (!Object.keys(draft.tokens).length) {
    return Response.json(
      { error: "No usable colours came back. Try clearer slide images." },
      { status: 502 }
    );
  }
  return Response.json(draft);
}
