import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { bodyTooLarge } from "@/lib/limits";
import { deleteDeckTemplate, getDeckTemplate, updateDeckTemplate } from "@/lib/db";
import {
  sanitiseFontsQuery,
  sanitiseLayoutCss,
  sanitiseLayouts,
  sanitiseLogo,
  sanitiseLogoPos,
  sanitiseTokens,
} from "@/lib/deck-template";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const t = await getDeckTemplate(id, userId);
  if (!t) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(t);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 80);
  }
  if (body.tokens !== undefined) patch.tokens = sanitiseTokens(body.tokens);
  if (body.layouts !== undefined) patch.layouts = sanitiseLayouts(body.layouts);
  if (body.fontsQuery !== undefined) patch.fonts_query = sanitiseFontsQuery(body.fontsQuery);
  if (body.imageStyle !== undefined) {
    patch.image_style =
      typeof body.imageStyle === "string" ? body.imageStyle.trim().slice(0, 400) : null;
  }
  if (body.logo !== undefined) patch.logo = sanitiseLogo(body.logo);
  if (body.logoPos !== undefined) patch.logo_pos = sanitiseLogoPos(body.logoPos);
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : null;
  }
  // Layout CSS is only meaningful against a layout list, so it is scoped
  // against whichever list will be in force after this patch.
  if (body.layoutCss !== undefined) {
    const existing = await getDeckTemplate(id, userId);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    const layouts = (patch.layouts as ReturnType<typeof sanitiseLayouts>) ?? existing.layouts;
    patch.layout_css = sanitiseLayoutCss(body.layoutCss, layouts);
  }

  const next = await updateDeckTemplate(id, patch, userId);
  if (!next) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(next);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const ok = await deleteDeckTemplate(id, userId);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
