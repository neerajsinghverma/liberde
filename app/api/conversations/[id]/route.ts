import { NextRequest } from "next/server";
import {
  deleteConversation,
  getConversation,
  getLiveTurn,
  listMessages,
  updateConversation,
} from "@/lib/db";

import { getRequestUserId, unauthorized } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

async function owned(id: string) {
  const userId = await getRequestUserId();
  if (!userId) return { error: unauthorized() };
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  }
  return { conv, userId };
}

// Mirror of LOCK_TTL_MS in lib/db.ts: a lock newer than this means a response
// is actively being generated (server-side), so the client should show a
// working indicator and poll for the result even if it isn't attached to the
// SSE stream (e.g. after a reload or a dropped connection).
const GENERATING_TTL_MS = 6 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const check = await owned(id);
  if (check.error) return check.error;
  const conv = check.conv!;
  const generating =
    conv.locked_at != null && Date.now() - conv.locked_at < GENERATING_TTL_MS;
  // Only while a turn is actually in flight: outside that window any row is
  // a leftover from a killed function, and showing it would resurrect a
  // reply the user already has in full.
  // Cosmetic, so it fails soft: losing the mirror costs a nicer reload,
  // losing the conversation costs the conversation.
  const live = generating ? await getLiveTurn(id).catch(() => null) : null;
  return Response.json({
    ...conv,
    generating,
    live,
    messages: await listMessages(id),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const check = await owned(id);
  if (check.error) return check.error;
  const body = await req.json();
  await updateConversation(id, {
    ...(body.title != null ? { title: body.title } : {}),
    ...(body.model != null ? { model: body.model } : {}),
    ...("projectId" in body ? { project_id: body.projectId } : {}),
    ...(typeof body.starred === "boolean" ? { starred: body.starred ? 1 : 0 } : {}),
    ...(typeof body.archived === "boolean" ? { archived: body.archived ? 1 : 0 } : {}),
    ...("designSystemId" in body ? { design_system_id: body.designSystemId ?? null } : {}),
  });
  return Response.json(await getConversation(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const check = await owned(id);
  if (check.error) return check.error;
  await deleteConversation(id);
  return Response.json({ ok: true });
}
