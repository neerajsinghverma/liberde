import { NextRequest } from "next/server";
import { getApiKey, verifyPlatformApiKey } from "@/lib/db";
import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "@/lib/openrouter";
import { applyPromptCache, cacheSessionId } from "@/lib/prompt-cache";
import {
  modelSupportsStructuredOutputs,
  validateResponseFormat,
} from "@/lib/structured-output";

export const runtime = "nodejs";

const apiError = (
  message: string,
  type: string,
  status: number,
  extra: Record<string, unknown> = {}
) => Response.json({ error: { message, type, ...extra } }, { status });

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
    return apiError(
      "Invalid or missing Liberde API key",
      "authentication_error",
      401
    );
  }
  if (!(await getApiKey(userId))) {
    return apiError("Server has no OpenRouter key configured", "server_error", 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Request body is not valid JSON", "invalid_request_error", 400);
  }
  if (!body.model) body.model = (await getSettings(userId)).defaultModel;
  const model = String(body.model);

  // Structured outputs. OpenRouter forwards `response_format` verbatim, so
  // without these two checks a bad schema or an incapable model surfaces as a
  // provider error that names fields the caller never wrote.
  const problem = validateResponseFormat(body.response_format);
  if (problem) {
    return apiError(problem.message, "invalid_request_error", 400, {
      param: problem.param,
      code: problem.code,
    });
  }
  const wantsSchema =
    (body.response_format as { type?: string } | undefined)?.type === "json_schema";
  if (wantsSchema && !(await modelSupportsStructuredOutputs(model))) {
    return apiError(
      `Model "${model}" does not support JSON Schema responses. Use a model with structured outputs, or fall back to \`response_format: {"type":"json_object"}\` and validate the reply yourself.`,
      "invalid_request_error",
      400,
      { param: "model", code: "model_not_supported" }
    );
  }

  // Repeated calls from one integration usually share a long system prompt, so
  // the same caching that pays off in chat pays off here. `user` is the OpenAI
  // dialect's caller-supplied identity, which is the closest thing to a thread.
  if (Array.isArray(body.messages)) {
    applyPromptCache(body.messages, { model, isOpenRouter: true });
  }
  if (typeof body.user === "string" && body.user) {
    body.session_id = cacheSessionId(body.user);
  }

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
