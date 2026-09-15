import { NextRequest } from "next/server";
import { getAgent,
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

/** Workspaces a conversation can belong to; anything else falls back to chat. */
const CONVERSATION_MODES = ["chat", "design", "present"];

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
  // Starting as an agent: its model seeds the conversation, so the picker
  // shows what will actually answer rather than a default the agent overrides.
  const agent =
    typeof body.agentId === "string" && body.agentId
      ? await getAgent(body.agentId, userId)
      : null;
  if (body.agentId && !agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  const model =
    body.model || agent?.model || (await getSettings(userId)).defaultModel;
  const conv = await createConversation(
    model,
    body.projectId ?? null,
    Boolean(body.temp),
    userId,
    CONVERSATION_MODES.includes(body.mode) ? body.mode : "chat",
    agent?.id ?? null
  );
  // Design mode pins a design system; Present mode pins a template. Both ids
  // are validated at generation time, so a stale one degrades gracefully
  // rather than blocking the conversation from being created.
  const pins: Parameters<typeof updateConversation>[1] = {};
  if (body.designSystemId && typeof body.designSystemId === "string") {
    pins.design_system_id = body.designSystemId;
  }
  if (body.deckTemplateId && typeof body.deckTemplateId === "string") {
    pins.deck_template_id = body.deckTemplateId;
    pins.deck_template_mode = body.deckTemplateMode === "layouts" ? "layouts" : "skin";
  }
  if (Object.keys(pins).length) {
    await updateConversation(conv.id, pins);
    return Response.json(await getConversation(conv.id), { status: 201 });
  }
  return Response.json(conv, { status: 201 });
}
