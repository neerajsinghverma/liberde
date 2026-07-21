import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getConversation, listArtifacts, listArtifactVersions } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const artifacts = await Promise.all(
    (await listArtifacts(id)).map(async (a) => ({
      ...a,
      versions: await listArtifactVersions(a.id),
    }))
  );
  return Response.json(artifacts);
}
