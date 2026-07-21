import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getApiKey } from "@/lib/db";
import { complete, getSettings, keyProblem, listModels } from "@/lib/openrouter";

export const runtime = "nodejs";

/**
 * Recommend a model from a free-text description of what the user wants. Uses a
 * cheap model to choose from the live catalog. The client falls back to its own
 * heuristic if this fails (no key, etc.).
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { text, task, priority } = await req.json();
  if (!text?.trim()) return Response.json({ error: "Describe what you need" }, { status: 400 });

  const key = await getApiKey(userId);
  if (!key || keyProblem(key)) {
    return Response.json({ error: "no-key" }, { status: 400 });
  }

  const models = await listModels();
  // Compact candidate shortlist from major providers to keep the prompt small.
  const MAJOR = /^(anthropic|openai|google|x-ai|deepseek|meta-llama|mistralai|qwen)\//;
  const candidates = models
    .filter((m) => m.context_length > 0 && MAJOR.test(m.id))
    .slice(0, 60)
    .map(
      (m) =>
        `${m.id} | ${m.name} | $${(parseFloat(m.pricing?.completion || "0") * 1e6).toFixed(2)}/Mout | ${Math.round(
          m.context_length / 1000
        )}K ctx${m.supportsImages ? " | vision" : ""}${m.supportsTools ? " | tools" : ""}`
    )
    .join("\n");

  const settings = await getSettings(userId);
  const sys = `You help a user pick the best AI model for their need from this catalog (id | name | price | context | capabilities):\n${candidates}\n\nReturn ONLY minified JSON: {"modelId":"<exact id from the list>","reason":"one sentence","alternatives":["<id>","<id>"]}. Pick the single best fit. reason must be short and specific to their need.`;

  try {
    const raw = await complete(
      settings.plannerModel || settings.titleModel || settings.defaultModel,
      [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Need: ${String(text).slice(0, 800)}${task ? `\nKind of work: ${task}` : ""}${
            priority ? `\nPriority: ${priority}` : ""
          }`,
        },
      ],
      { temperature: 0.2, max_tokens: 300 },
      userId
    );
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const valid = new Set(models.map((m) => m.id));
    if (!valid.has(json.modelId)) {
      return Response.json({ error: "no-match" }, { status: 422 });
    }
    return Response.json({
      modelId: json.modelId,
      reason: String(json.reason ?? "").slice(0, 240),
      alternatives: Array.isArray(json.alternatives)
        ? json.alternatives.filter((id: string) => valid.has(id) && id !== json.modelId).slice(0, 2)
        : [],
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not pick a model" },
      { status: 500 }
    );
  }
}
