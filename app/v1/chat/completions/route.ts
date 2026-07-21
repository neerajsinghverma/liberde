import { NextRequest } from "next/server";
import { getApiKey, verifyPlatformApiKey } from "@/lib/db";
import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "@/lib/openrouter";

export const runtime = "nodejs";

/**
 * OpenAI-compatible chat completions endpoint for the Liberde platform.
 * External apps authenticate with a Liberde API key (created in Settings);
 * the server calls OpenRouter with its own upstream key.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = key ? await verifyPlatformApiKey(key) : null;
  if (!userId) {
    return Response.json(
      { error: { message: "Invalid or missing Liberde API key", type: "authentication_error" } },
      { status: 401 }
    );
  }
  if (!(await getApiKey(userId))) {
    return Response.json(
      { error: { message: "Server has no OpenRouter key configured", type: "server_error" } },
      { status: 500 }
    );
  }

  const body = await req.json();
  if (!body.model) body.model = (await getSettings(userId)).defaultModel;

  const upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: await openRouterHeaders(userId),
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (body.stream) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
