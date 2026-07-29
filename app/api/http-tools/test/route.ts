import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getHttpTool } from "@/lib/db";
import { performHttpCall } from "@/lib/http-tools";
import type { HttpTool } from "@/lib/types";

export const runtime = "nodejs";

/** Run one HTTP tool once with sample args — for the Settings "Test" button. */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const t = (body.tool ?? {}) as HttpTool;
  if (!t.url_template) return Response.json({ error: "A URL is required." }, { status: 400 });

  // Secret: use the one typed in the form, else fall back to the stored one.
  let secret: string | null = body.authSecret ?? null;
  if (secret == null && body.id) {
    const stored = await getHttpTool(String(body.id), userId);
    secret = stored?.auth_secret ?? null;
  }

  const result = await performHttpCall(
    {
      ...t,
      method: (t.method || "GET").toUpperCase(),
      params: Array.isArray(t.params) ? t.params : [],
      headers: t.headers ?? {},
      auth: t.auth ?? { type: "none" },
      body_mode: t.body_mode === "template" ? "template" : "auto",
      max_response_bytes: Number(t.max_response_bytes) || 24576,
      auth_secret: secret,
    } as HttpTool & { auth_secret: string | null },
    (body.args as Record<string, unknown>) ?? {}
  );
  return Response.json({ result });
}
