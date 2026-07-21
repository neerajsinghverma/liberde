import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { createSharedChat, deleteSharedChatsFor, getConversation } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** Create an immutable public snapshot of the conversation (like ChatGPT share links). */
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return Response.json({ error: "Not found" }, { status: 404 });
  if (conv.is_temp) {
    return Response.json({ error: "Temporary chats can't be shared" }, { status: 400 });
  }
  const shared = await createSharedChat(id);
  return Response.json({ shareId: shared!.id }, { status: 201 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteSharedChatsFor(id);
  return Response.json({ ok: true });
}
