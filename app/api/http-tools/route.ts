import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  listHttpTools,
  createHttpTool,
  updateHttpTool,
  deleteHttpTool,
  deleteHttpToolGroup,
} from "@/lib/db";
import type { HttpTool } from "@/lib/types";

export const runtime = "nodejs";

const NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/;

/** Coerce an incoming client payload into a stored HttpTool shape. */
function normalize(body: Record<string, unknown>) {
  const auth = (body.auth as HttpTool["auth"]) ?? { type: "none" };
  return {
    name: String(body.name ?? "").trim(),
    description: String(body.description ?? "").trim(),
    method: String(body.method ?? "GET").toUpperCase(),
    url_template: String(body.url_template ?? "").trim(),
    params: Array.isArray(body.params) ? (body.params as HttpTool["params"]) : [],
    headers: (body.headers as Record<string, string>) ?? {},
    auth: { type: auth.type ?? "none", in: auth.in, name: auth.name },
    body_mode: body.body_mode === "template" ? ("template" as const) : ("auto" as const),
    body_template: (body.body_template as string) ?? null,
    response_extract: (body.response_extract as string) || null,
    max_response_bytes: Number(body.max_response_bytes) || 24576,
    auto_run: body.auto_run ? 1 : 0,
    source: body.source === "openapi" ? ("openapi" as const) : ("manual" as const),
    openapi_group: (body.openapi_group as string) ?? null,
    enabled: body.enabled === 0 || body.enabled === false ? 0 : 1,
  };
}

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json({ tools: await listHttpTools(userId) });
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));

  // Support a single tool or a batch (OpenAPI import selection).
  const items: Record<string, unknown>[] = Array.isArray(body.tools) ? body.tools : [body];
  const created: HttpTool[] = [];
  for (const raw of items) {
    const t = normalize(raw);
    if (!NAME_RE.test(t.name)) {
      return Response.json(
        { error: `Invalid tool name "${t.name}" — use letters, numbers, _ or - (max 48).` },
        { status: 400 }
      );
    }
    if (!t.url_template) return Response.json({ error: "A URL is required." }, { status: 400 });
    created.push(await createHttpTool(userId, { ...t, auth_secret: (raw.authSecret as string) ?? null }));
  }
  return Response.json({ ok: true, created: created.length }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  // Quick enable/disable toggle without re-sending the whole tool.
  if (typeof body.enabled === "boolean" && Object.keys(body).length <= 2) {
    await updateHttpTool(id, userId, { enabled: body.enabled ? 1 : 0 });
    return Response.json({ ok: true });
  }
  const t = normalize(body);
  if (!NAME_RE.test(t.name)) return Response.json({ error: "Invalid tool name." }, { status: 400 });
  await updateHttpTool(id, userId, {
    ...t,
    // undefined = keep existing secret; a string (incl. "") = replace it
    ...(body.authSecret === undefined ? {} : { auth_secret: String(body.authSecret) }),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  const group = req.nextUrl.searchParams.get("group");
  if (group) await deleteHttpToolGroup(group, userId);
  else if (id) await deleteHttpTool(id, userId);
  else return Response.json({ error: "id or group required" }, { status: 400 });
  return Response.json({ ok: true });
}
