import { NextRequest } from "next/server";
import { getArtifactByShareId } from "@/lib/db";

type Params = { params: Promise<{ shareId: string }> };

/** Public endpoint: resolve a shared artifact to its viewable content. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { shareId } = await params;
  const shared = await getArtifactByShareId(shareId);
  if (!shared || !shared.resolved) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({
    title: shared.title,
    type: shared.type,
    language: shared.language,
    version: shared.resolved.version,
    content: shared.resolved.content,
    updated_at: shared.resolved.created_at,
  });
}
