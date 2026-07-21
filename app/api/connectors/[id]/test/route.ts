import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getConnector, setConnectorTools, setSetting } from "@/lib/db";
import { testConnector } from "@/lib/mcp";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const connector = await getConnector(id);
  // Verify ownership before doing anything: testing a connector spawns its
  // subprocess (stdio) or fires an authenticated request carrying its token.
  if (!connector || (connector.user_id && connector.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Remember our public origin so OAuth redirect URIs are registered correctly.
  await setSetting("base_url", req.nextUrl.origin);
  const result = await testConnector(connector);
  // Cache the discovered tools so the panel can show them without reconnecting.
  if (result.ok && result.tools) await setConnectorTools(id, result.tools);
  return Response.json(result);
}
