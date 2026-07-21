import { NextRequest } from "next/server";
import { forkConversation, getConversation } from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const forked = await forkConversation(id, userId);
  if (!forked) return Response.json({ error: "Could not fork" }, { status: 500 });
  return Response.json({ conversationId: forked.id }, { status: 201 });
}
