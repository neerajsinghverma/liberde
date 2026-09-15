import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { bodyTooLarge } from "@/lib/limits";
import { createDeckTemplate, listDeckTemplates } from "@/lib/db";
import {
  sanitiseFontsQuery,
  sanitiseLayoutCss,
  sanitiseLayouts,
  sanitiseLogo,
  sanitiseLogoPos,
  sanitiseTokens,
} from "@/lib/deck-template";

export const runtime = "nodejs";

const SOURCES = new Set(["screenshots", "deck", "brand-doc", "manual"]);

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listDeckTemplates(userId));
}

/**
 * Save a Present template. Everything structural is sanitised here rather than
 * at render time, so a template in the database is already safe to interpolate
 * into a stylesheet — the extraction endpoints and the UI both come through
 * this door.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  const body = await req.json().catch(() => ({}));

  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "A name is required" }, { status: 400 });

  const tokens = sanitiseTokens(body.tokens);
  const layouts = sanitiseLayouts(body.layouts);
  if (!Object.keys(tokens).length && !layouts.length) {
    return Response.json(
      { error: "A template needs at least a palette or one layout" },
      { status: 400 }
    );
  }

  const template = await createDeckTemplate(
    {
      name,
      source: SOURCES.has(body.source) ? body.source : "manual",
      tokens,
      fonts_query: sanitiseFontsQuery(body.fontsQuery ?? body.fonts_query),
      image_style:
        typeof body.imageStyle === "string" ? body.imageStyle.trim().slice(0, 400) : null,
      logo: sanitiseLogo(body.logo),
      logo_pos: sanitiseLogoPos(body.logoPos ?? body.logo_pos),
      layout_css: sanitiseLayoutCss(body.layoutCss ?? body.layout_css, layouts),
      layouts,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : null,
    },
    userId
  );
  return Response.json(template, { status: 201 });
}
