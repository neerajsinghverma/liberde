import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  addArtifactVersion,
  getArtifact,
  getArtifactVersion,
  getConversation,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** User-authored edit: save new content as the next version (Claude-style canvas editing). */
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const artifact = await getArtifact(id);
  if (!artifact) return Response.json({ error: "Not found" }, { status: 404 });
  const conv = await getConversation(artifact.conversation_id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  const latest = await getArtifactVersion(id);
  if (latest && latest.content === body.content) {
    return Response.json(latest); // no-op edit
  }
  const version = await addArtifactVersion(id, body.content, null);
  return Response.json(version, { status: 201 });
}
