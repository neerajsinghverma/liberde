import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getConversation, unlockConversation } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** Release the conversation's generation lock — used by Stop / cancel so a
 *  stuck or background run can be cleared and the user can send again. */
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await unlockConversation(id);
  return Response.json({ ok: true });
}
