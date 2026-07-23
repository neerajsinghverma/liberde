import { NextRequest } from "next/server";
import { getRequestUserId, getUserByEmail, unauthorized } from "@/lib/auth";
import {
  getArtifact,
  getConversation,
  listArtifactShares,
  shareArtifactWithUser,
  unshareArtifactWithUser,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Only the artifact's owner (via its parent conversation) manages shares. */
async function ownedArtifact(id: string, userId: string) {
  const artifact = await getArtifact(id);
  if (!artifact) return null;
  const conv = await getConversation(artifact.conversation_id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return null;
  return artifact;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!(await ownedArtifact(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(await listArtifactShares(id));
}

/** Share the artifact with another Liberde user by email. */
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!(await ownedArtifact(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const target = await getUserByEmail(String(body.email ?? ""));
  if (!target) {
    return Response.json(
      { error: "No user with that email — they need a Liberde account first" },
      { status: 404 }
    );
  }
  if (target.id === userId) {
    return Response.json({ error: "That's you — it's already yours" }, { status: 400 });
  }
  await shareArtifactWithUser(id, target.id);
  return Response.json(await listArtifactShares(id));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const artifact = await getArtifact(id);
  if (!artifact) return Response.json({ error: "Not found" }, { status: 404 });
  const conv = await getConversation(artifact.conversation_id);
  const isOwner = Boolean(conv && (!conv.user_id || conv.user_id === userId));
  const targetId = String(body.userId ?? userId);
  // Owner removes anyone; a recipient can remove themselves.
  if (!isOwner && targetId !== userId) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  await unshareArtifactWithUser(id, targetId);
  return Response.json(isOwner ? await listArtifactShares(id) : { ok: true });
}
