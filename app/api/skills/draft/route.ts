import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { listConnectors } from "@/lib/db";
import { complete, getSettings } from "@/lib/openrouter";

export const runtime = "nodejs";

/**
 * AI-assisted skill authoring: from a plain-language description (and the user's
 * connected MCP tools), draft a structured skill — name, when-to-use, step
 * instructions, and which connectors it should use.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { prompt } = await req.json();
  if (!prompt?.trim()) return Response.json({ error: "Describe the skill first" }, { status: 400 });

  const settings = await getSettings(userId);
  const connectors = await listConnectors(userId);
  // Give the model the tool inventory so it can wire the right connectors in.
  const inventory = connectors
    .filter((c) => c.enabled)
    .map((c) => {
      let tools: { name: string; description: string }[] = [];
      try {
        tools = c.tools_cache ? JSON.parse(c.tools_cache) : [];
      } catch {
        tools = [];
      }
      const toolList = tools.length
        ? tools.map((t) => `    - ${t.name}: ${(t.description || "").slice(0, 80)}`).join("\n")
        : "    (not tested yet — no known tools)";
      return `- connector id ${c.id} "${c.name}":\n${toolList}`;
    })
    .join("\n");

  const sys = `You design "skills" for an AI assistant. A skill has: a short name, a one-line "when to use it" description, and detailed step-by-step instructions the assistant follows once the skill is triggered. If the user's connected tools are relevant, reference them by their exact tool name in the instructions and list the connector ids to attach.

The user's connected MCP connectors and tools:
${inventory || "(none connected)"}

Reply with ONLY minified JSON: {"name":"...","description":"...","instructions":"...","connectorIds":["id",...]}. instructions should be concrete and numbered. connectorIds must be a subset of the ids above (or []).`;

  try {
    const raw = await complete(
      settings.plannerModel || settings.defaultModel,
      [
        { role: "system", content: sys },
        { role: "user", content: `Design a skill for: ${String(prompt).slice(0, 1500)}` },
      ],
      { temperature: 0.4, max_tokens: 900 },
      userId
    );
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const validIds = new Set(connectors.map((c) => c.id));
    return Response.json({
      name: String(json.name ?? "").slice(0, 60),
      description: String(json.description ?? "").slice(0, 300),
      instructions: String(json.instructions ?? ""),
      connectorIds: Array.isArray(json.connectorIds)
        ? json.connectorIds.map(String).filter((id: string) => validIds.has(id))
        : [],
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not draft the skill" },
      { status: 500 }
    );
  }
}
