import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  updateConnector,
} from "@/lib/db";
import { dropConnection } from "@/lib/mcp";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  // Never leak header secrets back to the client wholesale; mask values.
  return Response.json({
    // Serverless platforms can't spawn local MCP subprocesses.
    stdioSupported: !process.env.VERCEL,
    connectors: (await listConnectors(userId)).map((c) => {
      let tools: { name: string; description: string }[] = [];
      try {
        tools = c.tools_cache ? JSON.parse(c.tools_cache) : [];
      } catch {
        tools = [];
      }
      return {
        ...c,
        headers: c.headers ? "(configured)" : null,
        oauth_data: undefined, // never leak tokens to the client
        tools_cache: undefined,
        tools,
        lastTested: c.last_tested ?? null,
        hasAuth: Boolean(c.oauth_data),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const transport = body.transport === "http" ? "http" : "stdio";
  if (transport === "stdio" && process.env.VERCEL) {
    return Response.json(
      { error: "Local (stdio) MCP servers aren't available on serverless hosting — use a remote HTTP server" },
      { status: 400 }
    );
  }
  if (transport === "stdio" && !body.command?.trim()) {
    return Response.json({ error: "command is required for stdio" }, { status: 400 });
  }
  if (transport === "http" && !body.url?.trim()) {
    return Response.json({ error: "url is required for http" }, { status: 400 });
  }
  let args: string | null = null;
  if (transport === "stdio" && body.args != null) {
    // accept either a JSON array or a plain space-separated string
    if (Array.isArray(body.args)) args = JSON.stringify(body.args.map(String));
    else if (typeof body.args === "string" && body.args.trim()) {
      args = JSON.stringify(body.args.trim().split(/\s+/));
    }
  }
  const headers =
    transport === "http" && body.bearerToken?.trim()
      ? JSON.stringify({ Authorization: `Bearer ${body.bearerToken.trim()}` })
      : null;

  const connector = await createConnector({
    name: body.name.trim().slice(0, 60),
    transport,
    command: transport === "stdio" ? body.command.trim() : null,
    args,
    url: transport === "http" ? body.url.trim() : null,
    headers,
  }, userId);
  return Response.json({ ...connector, headers: headers ? "(configured)" : null }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const connector = await getConnector(body.id);
  if (!connector || (connector.user_id && connector.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (typeof body.enabled === "boolean") {
    await updateConnector(connector.id, { enabled: body.enabled ? 1 : 0 });
    if (!body.enabled) dropConnection(connector.id);
  }
  const updated = (await getConnector(connector.id))!;
  return Response.json({ ...updated, headers: updated.headers ? "(configured)" : null });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const connector = await getConnector(id);
  if (!connector || (connector.user_id && connector.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  dropConnection(id);
  await deleteConnector(id);
  return Response.json({ ok: true });
}
