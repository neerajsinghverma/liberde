import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createDeckTemplate,
  getArtifact,
  getArtifactVersion,
  getConversation,
  getDeckTemplate,
} from "@/lib/db";
import { findDeckTheme, readDeckAttr } from "@/lib/deck-runtime";
import { sanitiseLogo, sanitiseLogoPos, TEMPLATE_TOKENS } from "@/lib/deck-template";

export const runtime = "nodejs";

/**
 * Save a deck you already got right as a reusable template.
 *
 * No model and no extraction: the deck already states its theme, and a theme is
 * already exactly the token set a template holds. So this reads the wrapper,
 * resolves the theme it names, and freezes those values under a name. A template
 * made this way is the most faithful of the three, because nothing was inferred.
 *
 * If the deck was itself built on a template, that template's tokens are carried
 * over instead of a built-in theme's, so "tweak it then save it again" works.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { artifactId, name } = await req.json().catch(() => ({}));
  if (typeof artifactId !== "string" || !artifactId) {
    return Response.json({ error: "artifactId is required" }, { status: 400 });
  }

  const artifact = await getArtifact(artifactId);
  if (!artifact || artifact.type !== "deck") {
    return Response.json({ error: "Not a deck" }, { status: 404 });
  }
  const conv = await getConversation(artifact.conversation_id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const version = await getArtifactVersion(artifact.id);
  if (!version) return Response.json({ error: "Deck has no content" }, { status: 404 });

  const content = version.content;
  const themeId = readDeckAttr(content, "data-theme");

  let tokens: Record<string, string> = {};
  let fontsQuery: string | null = null;
  let imageStyle: string | null = null;
  let layoutCss: string | null = null;
  let layouts: { id: string; label: string; hint: string }[] = [];

  // A deck on a template: inherit that template wholesale, so repeated
  // save-and-refine converges instead of degrading to a built-in theme.
  const sourceTemplateId = readDeckAttr(content, "data-template");
  const parent = sourceTemplateId
    ? await getDeckTemplate(sourceTemplateId, userId)
    : conv.deck_template_id
      ? await getDeckTemplate(conv.deck_template_id, userId)
      : undefined;

  if (themeId === "custom" && parent) {
    tokens = parent.tokens;
    fontsQuery = parent.fonts_query;
    imageStyle = parent.image_style;
    layoutCss = parent.layout_css;
    layouts = parent.layouts;
  } else {
    // Freeze the built-in theme the deck actually used.
    const theme = findDeckTheme(themeId);
    const k = theme.tokens;
    const from: Record<string, string> = {
      bg: k.bg,
      surface: k.surface,
      "card-gradient": k.cardGradient || "none",
      ink: k.ink,
      muted: k.muted,
      accent: k.accent,
      "accent-2": k.accent2,
      radius: k.radius,
      shadow: k.shadow,
      stroke: k.stroke,
      "heading-weight": String(k.headingWeight),
      "heading-tracking": k.headingTracking,
      "kicker-transform": k.kickerTransform,
      "heading-font": theme.fonts.heading,
      "body-font": theme.fonts.body,
    };
    for (const key of TEMPLATE_TOKENS) if (from[key]) tokens[key] = from[key];
    fontsQuery = theme.fonts.google;
    imageStyle = theme.imageStyle;
  }

  // Carry over the running logo the deck was using, if any.
  let logo: string | null = null;
  let logoPos: string | null = null;
  for (const pos of ["br", "bl", "tr", "tl", "tc", "bc"]) {
    const slot = readDeckAttr(content, "data-hf-" + pos);
    if (slot && slot.startsWith("logo:")) {
      logo = sanitiseLogo(slot.slice(5));
      logoPos = sanitiseLogoPos(pos);
      if (logo) break;
    }
  }
  if (!logo && parent) {
    logo = parent.logo;
    logoPos = parent.logo_pos;
  }

  const template = await createDeckTemplate(
    {
      name: String(name ?? artifact.title ?? "Saved deck").trim().slice(0, 80) || "Saved deck",
      source: "deck",
      tokens,
      fonts_query: fontsQuery,
      image_style: imageStyle,
      logo,
      logo_pos: logoPos,
      layout_css: layoutCss,
      layouts,
      notes:
        "Saved from the deck " +
        JSON.stringify(artifact.title) +
        ". Density " +
        (readDeckAttr(content, "data-density") || "medium") +
        ", size " +
        (readDeckAttr(content, "data-size") || "fluid") +
        ", format " +
        (readDeckAttr(content, "data-format") || "presentation") +
        ".",
    },
    userId
  );
  return Response.json(template, { status: 201 });
}
