import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { complete, getSettings, DEFAULT_TITLE_MODEL } from "@/lib/openrouter";
import type { HttpToolParam } from "@/lib/types";

export const runtime = "nodejs";

/**
 * AI-assisted custom-tool authoring: from a plain-language description of an API,
 * draft a structured HTTP tool (name, method, URL with {{placeholders}}, params,
 * auth) for the user to review before saving.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { prompt, model } = await req.json();
  if (!prompt?.trim()) return Response.json({ error: "Describe the API tool first" }, { status: 400 });

  const settings = await getSettings(userId);
  const chosen =
    (typeof model === "string" && model.trim() && model !== "auto" && model) ||
    (settings.plannerModel && settings.plannerModel !== "auto" && settings.plannerModel) ||
    (settings.titleModel && settings.titleModel !== "auto" && settings.titleModel) ||
    DEFAULT_TITLE_MODEL;

  const sys = `You configure REST/HTTP API endpoints as callable "tools" for an AI assistant. From the user's description, produce ONE tool definition.

Rules:
- If the user names a real, well-known public API, use its ACTUAL base URL and endpoint path. Do NOT invent endpoints for APIs you're unsure of — if unknown, use your best guess and keep params generic.
- Put path parameters in the URL as {{paramName}} placeholders (e.g. https://api.x.com/users/{{id}}).
- Every value the model must supply becomes a param with a "location": "path" | "query" | "body" | "header".
- Pick method GET for reads, POST/PUT/PATCH/DELETE for writes.
- If the API needs a key, set auth: {"type":"bearer"} or {"type":"apiKey","in":"header"|"query","name":"X-Api-Key"} or {"type":"basic"}; else {"type":"none"}. Never invent a secret value.

Reply with ONLY minified JSON:
{"name":"snake_case_name","description":"when to use it","method":"GET","url_template":"https://...","params":[{"name":"...","type":"string|number|integer|boolean","location":"path|query|body|header","required":true,"description":"..."}],"auth":{"type":"none|bearer|apiKey|basic","in":"header|query","name":"..."}}`;

  try {
    const raw = await complete(
      chosen,
      [
        { role: "system", content: sys },
        { role: "user", content: `Configure a tool for: ${String(prompt).slice(0, 1500)}` },
      ],
      { temperature: 0.3, max_tokens: 900 },
      userId
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(j.method).toUpperCase())
      ? String(j.method).toUpperCase()
      : "GET";
    const params: HttpToolParam[] = Array.isArray(j.params)
      ? j.params
          .map((p: Record<string, unknown>) => ({
            name: String(p.name ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40),
            type: (["string", "number", "integer", "boolean"].includes(String(p.type))
              ? String(p.type)
              : "string") as HttpToolParam["type"],
            location: (["path", "query", "body", "header"].includes(String(p.location))
              ? String(p.location)
              : "query") as HttpToolParam["location"],
            required: Boolean(p.required),
            description: p.description ? String(p.description).slice(0, 200) : undefined,
          }))
          .filter((p: HttpToolParam) => p.name)
      : [];
    const at = String(j.auth?.type ?? "none");
    const auth = {
      type: ["none", "bearer", "apiKey", "basic"].includes(at) ? at : "none",
      in: j.auth?.in === "query" ? "query" : j.auth?.in === "header" ? "header" : undefined,
      name: j.auth?.name ? String(j.auth.name).slice(0, 60) : undefined,
    };
    return Response.json({
      name: String(j.name ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48),
      description: String(j.description ?? "").slice(0, 300),
      method,
      url_template: String(j.url_template ?? "").slice(0, 500),
      params,
      auth,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not draft the tool" },
      { status: 500 }
    );
  }
}
