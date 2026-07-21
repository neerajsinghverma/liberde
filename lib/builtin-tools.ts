// Built-in tools offered to every tool-capable model, Claude.ai-style:
// the model decides when to search the web or read a page — no toggle needed.

import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "./openrouter";
import { assertPublicHost } from "./ssrf";
import type { ToolDef } from "./mcp";

// Cap fetched-page bodies so a huge/streaming response can't exhaust memory.
const MAX_FETCH_BYTES = 2_000_000;

export const WEB_TOOLS_PROMPT = `# Web tools

You can call web_search whenever current, post-cutoff, or verifiable information would improve your answer (news, prices, versions, schedules, facts you're unsure of) — search proactively rather than disclaiming stale knowledge, and search more than once with different queries when the first pass isn't enough. Use fetch_page to read a specific URL in full (one the user gave you or a promising search result). Cite what you learned; the interface shows your sources automatically.`;

export const BUILTIN_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Returns dense findings with source URLs. Use for anything time-sensitive, post-cutoff, or worth verifying.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A focused search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description:
        "Fetch a URL and return its readable text content (truncated). Use to read a specific page in depth.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s) URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
];

export const isBuiltinTool = (name: string) =>
  name === "web_search" || name === "fetch_page";

export interface BuiltinToolResult {
  output: string;
  annotations: unknown[];
  /** USD cost of any upstream call this tool made. */
  cost?: number;
}

export async function execBuiltinTool(
  name: string,
  argsJson: string,
  userId?: string
): Promise<BuiltinToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { output: "Error: tool arguments were not valid JSON", annotations: [] };
  }
  try {
    if (name === "web_search") return await webSearch(String(args.query ?? ""), userId);
    if (name === "fetch_page") return await fetchPage(String(args.url ?? ""));
  } catch (e) {
    return { output: `Error: ${String(e).slice(0, 300)}`, annotations: [] };
  }
  return { output: `Error: unknown builtin tool ${name}`, annotations: [] };
}

async function webSearch(query: string, userId?: string): Promise<BuiltinToolResult> {
  if (!query.trim()) return { output: "Error: empty query", annotations: [] };
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: await openRouterHeaders(userId),
    body: JSON.stringify({
      model: (await getSettings(userId)).titleModel,
      plugins: [{ id: "web", max_results: 6 }],
      usage: { include: true },
      messages: [
        {
          role: "user",
          content: `Search the web for: "${query}". Report the key findings densely and factually — specific figures, dates, names. No filler.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = (await res.clone().text()).slice(0, 500);
    console.error(`[web_search] OpenRouter ${res.status}: ${detail}`);
    return {
      output: `Error: search failed (${res.status}) ${(await res.text()).slice(0, 200)}`,
      annotations: [],
    };
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  const annotations = (message?.annotations ?? []) as {
    url_citation?: { url?: string; title?: string };
  }[];
  const sources = annotations
    .map((a) => a.url_citation)
    .filter((c): c is { url: string; title?: string } => Boolean(c?.url))
    .map((c, i) => `[${i + 1}] ${c.title ?? c.url} — ${c.url}`);
  const output = [
    message?.content ?? "(no findings)",
    sources.length ? `\nSources:\n${sources.join("\n")}` : "",
  ]
    .join("\n")
    .slice(0, 8000);
  return { output, annotations, cost: Number(data.usage?.cost) || 0 };
}

async function fetchPage(url: string): Promise<BuiltinToolResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { output: "Error: only http(s) URLs are supported", annotations: [] };
  }
  // Follow redirects manually so every hop is SSRF-checked.
  let current = new URL(url);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(current);
    res = await fetch(current, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Liberde/1.0 (+self-hosted AI assistant)" },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      current = new URL(location, current);
      continue;
    }
    break;
  }
  if (!res) return { output: `Error: too many redirects fetching ${url}`, annotations: [] };
  if (!res.ok) return { output: `Error: HTTP ${res.status} fetching ${url}`, annotations: [] };
  const type = res.headers.get("content-type") ?? "";
  const body = await readCapped(res, MAX_FETCH_BYTES);
  let text = body;
  if (type.includes("html")) {
    text = body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
  const annotations = [
    { type: "url_citation", url_citation: { url, title: url } },
  ];
  return { output: text.slice(0, 8000) || "(page had no readable text)", annotations };
}

/** Read a response body up to `limit` bytes, then stop — bounds memory use. */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= limit) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  return new TextDecoder().decode(concatChunks(chunks));
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
