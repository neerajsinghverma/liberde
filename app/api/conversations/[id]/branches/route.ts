import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  getConversation,
  listBranches,
  listMessages,
  switchToBranch,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(
    (await listBranches(id)).map((b) => ({
      id: b.id,
      anchor_id: b.anchor_id,
      preview: b.preview,
      created_at: b.created_at,
    }))
  );
}

/** Switch the live conversation tail to a stored branch. */
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const restored = await switchToBranch(id, body.branchId);
  if (!restored) return Response.json({ error: "Branch not found" }, { status: 404 });
  // Artifact versions are retained across branch swaps, so nothing to rebuild.
  return Response.json({ ok: true, messages: await listMessages(id) });
}
