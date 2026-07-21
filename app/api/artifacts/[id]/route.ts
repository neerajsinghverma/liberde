import crypto from "crypto";
import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  getArtifact,
  getArtifactVersion,
  getConversation,
  setArtifactShare,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH manages publishing:
 *   { publish: true, mode: "latest" }                → share, always latest version
 *   { publish: true, mode: "pinned", version: 3 }    → share a fixed version
 *   { publish: false }                               → unpublish
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const artifact = await getArtifact(id);
  if (!artifact) return Response.json({ error: "Not found" }, { status: 404 });
  // Publishing exposes the artifact's content on a public share URL — only its
  // owner (via the parent conversation) may do it.
  const conv = await getConversation(artifact.conversation_id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();

  if (body.publish === false) {
    await setArtifactShare(id, { share_id: null, share_mode: null, pinned_version: null });
    return Response.json(await getArtifact(id));
  }

  const mode: "latest" | "pinned" = body.mode === "pinned" ? "pinned" : "latest";
  let pinned: number | null = null;
  if (mode === "pinned") {
    const v = await getArtifactVersion(id, Number(body.version));
    if (!v) return Response.json({ error: "Unknown version" }, { status: 400 });
    pinned = v.version;
  }
  // Keep an existing share URL stable across republishes.
  const shareId = artifact.share_id ?? crypto.randomBytes(8).toString("base64url");
  await setArtifactShare(id, { share_id: shareId, share_mode: mode, pinned_version: pinned });
  return Response.json(await getArtifact(id));
}
