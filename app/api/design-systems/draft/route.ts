import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { bodyTooLarge } from "@/lib/limits";
import {
  complete,
  getSettings,
  type ChatCompletionMessage,
} from "@/lib/openrouter";

export const runtime = "nodejs";

/**
 * AI-assisted design-system authoring (the Claude Design "extract"/"Remix"
 * flow): from a plain-language brand description — or an existing spec plus a
 * change instruction — draft a structured design system: name, a markdown spec
 * the design model builds from, and a preview palette.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  const { prompt, current, name, images, model } = await req.json();
  // Screenshots / brand assets to extract from (data URLs). With images, a
  // bare prompt is optional — "extract from these" is implied.
  const imageUrls: string[] = Array.isArray(images)
    ? images
        .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("data:image/"))
        .slice(0, 4)
    : [];
  if (!prompt?.trim() && imageUrls.length === 0) {
    return Response.json(
      { error: "Describe the brand or attach screenshots first" },
      { status: 400 }
    );
  }

  const settings = await getSettings(userId);
  const remix = typeof current === "string" && current.trim().length > 0;

  const sys = `You author design systems for an AI design studio. A design system is a markdown spec the studio follows when building HTML/CSS prototypes, decks, and landing pages. It must contain these sections:
# Palette — primary, secondary, accent, background, surface, text colors as hex, each with a one-line usage note
# Typography — heading + body font families (Google Fonts), the type scale, weights
# Spacing & layout — spacing rhythm, radii, grid/max-width, shadow style
# Components — button/card/nav/input styling rules, concise and concrete
# Voice & imagery — copy tone and imagery direction, 2-3 lines

Keep the spec tight (under 350 words), concrete, and buildable — real hex values, real font names, no vague adjectives without a value attached.

Reply with ONLY minified JSON: {"name":"...","spec":"...markdown...","palette":["#hex","#hex","#hex","#hex","#hex"]}. palette lists the 4-6 most representative colors, primary first.`;

  const userText = remix
    ? `Revise this existing design system per the instruction. Preserve everything not asked to change.\n\nInstruction: ${String(prompt).slice(0, 1200)}\n\nCurrent system${name ? ` "${name}"` : ""}:\n${String(current).slice(0, 4000)}`
    : imageUrls.length
      ? `Extract a design system from the attached screenshot(s)/brand assets — read the actual colors, fonts, spacing, and component styles you can see.${
          prompt?.trim() ? ` Extra guidance: ${String(prompt).slice(0, 1200)}` : ""
        }`
      : `Create a design system from this description: ${String(prompt).slice(0, 2000)}`;
  // With screenshots, attach them as image parts (needs a vision-capable model).
  const userMessage: ChatCompletionMessage = imageUrls.length
    ? {
        role: "user",
        content: [
          { type: "text", text: userText },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      }
    : { role: "user", content: userText };

  // Explicit override first (the UI offers a vision-model picker when
  // screenshots are attached); otherwise prefer a competent helper model — the
  // user's default may be a weak/free reasoning model that can't produce clean
  // JSON (planner → title → default).
  const draftModel =
    (typeof model === "string" && model.trim()) ||
    settings.plannerModel ||
    settings.titleModel ||
    settings.defaultModel;
  try {
    let raw = await complete(
      draftModel,
      [{ role: "system", content: sys }, userMessage],
      { temperature: 0.5, max_tokens: 2000 },
      userId
    );
    let json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (!json.spec) {
      // One retry, more forceful about the output contract.
      raw = await complete(
        draftModel,
        [
          { role: "system", content: `${sys}\n\nIMPORTANT: reply with ONLY the JSON object, no prose, no markdown fences.` },
          userMessage,
        ],
        { temperature: 0.3, max_tokens: 2000 },
        userId
      );
      json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    }
    const palette = Array.isArray(json.palette)
      ? json.palette
          .map(String)
          .filter((c: string) => /^#[0-9a-fA-F]{3,8}$/.test(c))
          .slice(0, 6)
      : [];
    if (!json.spec) throw new Error("The model returned no spec — try rephrasing");
    return Response.json({
      name: String(json.name ?? name ?? "").slice(0, 60),
      spec: String(json.spec),
      palette: JSON.stringify(palette),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not draft the design system" },
      { status: 500 }
    );
  }
}
