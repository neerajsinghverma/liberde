import { NextRequest } from "next/server";
import {
  createConversation,
  getConversation,
  listArchivedConversations,
  listConversations,
  searchConversations,
  updateConversation,
} from "@/lib/db";
import { getSettings } from "@/lib/openrouter";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { canAccessProject } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (q) return Response.json(await searchConversations(q, userId));
  if (req.nextUrl.searchParams.get("archived") === "1") {
    return Response.json(await listArchivedConversations(userId));
  }
  const mode = req.nextUrl.searchParams.get("mode") || "chat";
  return Response.json(await listConversations(userId, mode));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (body.projectId && !(await canAccessProject(body.projectId, userId))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const model = body.model || (await getSettings(userId)).defaultModel;
  const conv = await createConversation(
    model,
    body.projectId ?? null,
    Boolean(body.temp),
    userId,
    body.mode === "design" ? "design" : "chat"
  );
  // Design mode: pin the chosen design system to the conversation (access is
  // validated at generation time, so a stale id degrades gracefully).
  if (body.designSystemId && typeof body.designSystemId === "string") {
    await updateConversation(conv.id, { design_system_id: body.designSystemId });
    return Response.json(await getConversation(conv.id), { status: 201 });
  }
  return Response.json(conv, { status: 201 });
}
