import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getArtifact, getConversation, getDeckAnalytics } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * Attention analytics for a published deck: how many people opened the link and
 * which cards they actually stopped on. Owner-only — the beacons are anonymous
 * but the summary is still the author's business, not the audience's.
 */
export async function GET(_req: Request, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const artifact = await getArtifact(id);
  if (!artifact) return Response.json({ error: "Not found" }, { status: 404 });
  const conv = await getConversation(artifact.conversation_id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(await getDeckAnalytics(id));
}
