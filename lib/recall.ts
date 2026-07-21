// Chat-history recall: a model-callable tool that searches the user's OWN past
// conversations so it can answer things like "who am I?" or "what did we decide
// about X?". Gated by the `recallEnabled` setting. Shared verbatim between the
// local (sqlite/sync) and cloud (postgres/async) codebases — every db call is
// awaited, and awaiting a sync return is harmless.
import { searchPastMessages, type RecallHit } from "./db";
import type { ToolDef } from "./mcp";

export const RECALL_SYSTEM_PROMPT = `# Recalling past chats
You can search the user's own past conversations with the search_past_chats tool. Use it when the user refers to something from before, asks what they told you previously, or asks about themselves ("who am I?", "what do I do?", "what did we decide?") and the answer isn't already in this conversation. Search with a few concrete keywords (a name, topic, project, or phrase). Treat what you find as the user's own history; cite it naturally ("From an earlier chat…"). If nothing relevant comes back, say you couldn't find it rather than guessing.`;

export const RECALL_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_past_chats",
      description:
        "Search the user's own previous conversations for relevant messages. Use to recall earlier context, decisions, or facts about the user that aren't in the current chat. Returns matching excerpts with the conversation title and date.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Keywords to search for across past chats (e.g. a name, topic, project, or a short phrase the user likely used).",
          },
        },
        required: ["query"],
      },
    },
  },
];

export function isRecallTool(name: string): boolean {
  return name === "search_past_chats";
}

export async function execRecallTool(
  name: string,
  argsJson: string,
  userId?: string
): Promise<string> {
  if (name !== "search_past_chats") return `Error: unknown recall tool "${name}"`;
  let query = "";
  try {
    query = String(JSON.parse(argsJson || "{}").query ?? "").trim();
  } catch {
    return "Error: tool arguments were not valid JSON";
  }
  if (!query) return "Error: provide a non-empty query to search past chats.";

  let hits: RecallHit[];
  try {
    hits = await searchPastMessages(query, userId, 8);
  } catch (e) {
    return `Error searching past chats: ${String(e).slice(0, 200)}`;
  }
  if (hits.length === 0) {
    return `No past chats mention "${query}".`;
  }
  const lines = hits.map((h) => {
    const when = new Date(Number(h.created_at)).toISOString().slice(0, 10);
    const who = h.role === "user" ? "User" : "Assistant";
    const text = h.content.replace(/\s+/g, " ").trim().slice(0, 400);
    return `- [${when}] "${h.title}" — ${who}: ${text}`;
  });
  return `Found ${hits.length} relevant excerpt(s) in past chats:\n${lines.join("\n")}`;
}
