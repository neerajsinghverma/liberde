import {
  addMemory,
  deleteMemory,
  findMemoryByPrefix,
  listMemories,
  updateMemory,
} from "./db";
import type { ToolDef } from "./mcp";

export const MEMORY_SYSTEM_PROMPT = `# Memory

You have persistent, EDITABLE memory across all of this user's conversations. Each remembered fact is shown with an id like [a1b2c3d4].

Managing memory (preferred, when you have tools): call memory_save to record a new durable fact; memory_update when a fact changed (new job, new preference — update, don't duplicate); memory_forget when the user asks you to forget something or a fact is obsolete. Fallback (no tools): emit <liberdeMemory>one short fact</liberdeMemory> in your reply to save.

Rules: only durable facts the user stated (name, role, preferences, goals, constraints) — never speculation or conversation-trivia; one fact per entry; keep entries current by updating rather than adding near-duplicates; don't announce memory operations — the interface surfaces them. Always honor explicit "remember this" and "forget that" requests.`;

const MEMORY_TAG = /<liberdeMemory>([\s\S]*?)<\/liberdeMemory>/g;

export async function buildMemoryContext(userId?: string): Promise<string> {
  const memories = await listMemories(userId);
  if (memories.length === 0) return "";
  return `# What you remember about the user\n${memories
    .map((m) => `- [${m.id.slice(0, 8)}] ${m.content}`)
    .join("\n")}`;
}

export const MEMORY_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "memory_save",
      description: "Save a new durable fact about the user to persistent memory.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "One short factual sentence" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_update",
      description:
        "Replace an existing memory's content (use the [id] shown in your memory context).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The memory id (8-char handle is fine)" },
          content: { type: "string", description: "The corrected fact" },
        },
        required: ["id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_forget",
      description: "Delete a memory (use the [id] shown in your memory context).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The memory id (8-char handle is fine)" },
        },
        required: ["id"],
      },
    },
  },
];

export const isMemoryTool = (name: string) =>
  name === "memory_save" || name === "memory_update" || name === "memory_forget";

export async function execMemoryTool(
  name: string,
  argsJson: string,
  userId?: string
): Promise<string> {
  let args: { content?: string; id?: string } = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return "Error: tool arguments were not valid JSON";
  }
  if (name === "memory_save") {
    const content = (args.content ?? "").trim();
    if (!content || content.length > 500) return "Error: content must be 1-500 chars";
    const record = await addMemory(content, userId);
    return `Saved memory [${record.id.slice(0, 8)}].`;
  }
  const target = await findMemoryByPrefix((args.id ?? "").trim(), userId);
  if (!target) return `Error: no memory matches id "${args.id}"`;
  if (name === "memory_update") {
    const content = (args.content ?? "").trim();
    if (!content || content.length > 500) return "Error: content must be 1-500 chars";
    await updateMemory(target.id, content);
    return `Updated memory [${target.id.slice(0, 8)}].`;
  }
  if (name === "memory_forget") {
    await deleteMemory(target.id);
    return `Forgot memory [${target.id.slice(0, 8)}].`;
  }
  return `Error: unknown memory tool ${name}`;
}

/** Extract memory tags from assistant output; returns cleaned text + count saved. */
export async function extractMemories(
  text: string,
  userId?: string
): Promise<{ cleaned: string; saved: number }> {
  const facts: string[] = [];
  const cleaned = text
    .replace(MEMORY_TAG, (_, fact: string) => {
      const trimmed = fact.trim();
      if (trimmed && trimmed.length <= 500) facts.push(trimmed);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n");
  for (const fact of facts) await addMemory(fact, userId);
  return { cleaned, saved: facts.length };
}
