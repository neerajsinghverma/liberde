// Built-in tools offered to every tool-capable model, Claude.ai-style:
// the model decides when to search the web or read a page — no toggle needed.

import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "./openrouter";
import { assertPublicHost } from "./ssrf";
import type { ToolDef } from "./mcp";
import { htmlToText } from "./html-text";
import { looksBinary, scrubText } from "./text-safe";
import { PDF_NO_TEXT } from "./types";

// Cap fetched-page bodies so a huge/streaming response can't exhaust memory.
const MAX_FETCH_BYTES = 2_000_000;
// And cap what reaches the model: enough of a long article to answer from,
// small enough that a few pages in one turn do not evict the conversation.
const MAX_PAGE_CHARS = 16_000;

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
        "Fetch a URL and return its readable text (HTML or PDF, truncated). Use to read a specific page or document in depth.",
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

/**
 * Read a URL as prose.
 *
 * Three things a page can be, and all three used to be handled by decoding the
 * bytes as UTF-8 and stripping angle brackets:
 *
 *  - HTML. Tag-stripping a modern page yields the nav, the language switcher
 *    and the footer, because that is what comes first in the document. The
 *    press release that prompted this returned 8,000 characters of menu and not
 *    one word of the release, which is why the model just called the tool again.
 *  - A PDF. Filings and press releases are routinely linked as PDFs; decoding
 *    one as text produces mojibake studded with NULs, and the NULs cannot be
 *    stored in a Postgres TEXT column — the INSERT threw, outside this tool's
 *    error handling, and took the whole turn down with it.
 *  - Something else binary. Same NUL problem, no readable text to salvage.
 */
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

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await readCapped(res, MAX_FETCH_BYTES);

  // PDF first: it is the common case for a link that is a document rather than
  // a page, and the one binary format worth extracting instead of refusing.
  if (type.includes("pdf") || hasMagic(bytes, PDF_MAGIC)) {
    return pageResult(url, await pdfToText(bytes));
  }
  if (looksBinary(bytes)) {
    return {
      output: `Error: ${url} returned binary data (${type || "unknown content type"}) with no readable text. If it is a document, link to a text or PDF version.`,
      annotations: [],
    };
  }
  if (type && !TEXTUAL_TYPE.test(type)) {
    return {
      output: `Error: ${url} is ${type}, which is not a readable document.`,
      annotations: [],
    };
  }
  const body = new TextDecoder().decode(bytes);
  const isHtml =
    type.includes("html") ||
    type.includes("xml") ||
    /<(!doctype html|html|body|div|article)\b/i.test(body.slice(0, 2000));
  return pageResult(url, isHtml ? htmlToText(readablePart(body)) : body);
}

/** Bytes a page can be turned into prose from; `text/*` plus the JSON/XML family. */
const TEXTUAL_TYPE =
  /^(text\/|application\/(json|xml|xhtml\+xml|javascript|x-ndjson|rss\+xml|atom\+xml)|application\/[\w.+-]+\+(json|xml))/i;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

const hasMagic = (bytes: Uint8Array, magic: number[]) =>
  magic.every((b, i) => bytes[i] === b);

/**
 * Package a page's text as a tool result: a `Source:` line so the model can
 * cite it and the interface can show the link, then the text, scrubbed of
 * anything a TEXT column would reject.
 */
function pageResult(url: string, text: string): BuiltinToolResult {
  const body = text.trim() || "(this page had no readable text)";
  const clipped = body.slice(0, MAX_PAGE_CHARS);
  const output = scrubText(
    `Source: ${url}\n\n${clipped}${clipped.length < body.length ? "\n\n[truncated]" : ""}`
  );
  return {
    output,
    annotations: [{ type: "url_citation", url_citation: { url, title: url } }],
  };
}

/**
 * Narrow an HTML document to the part worth reading: drop the chrome, then
 * prefer `<main>`/`<article>` when the page marks one. A single-page-app shell
 * has an empty `<main>`, so a short one falls back to the whole document.
 */
function readablePart(html: string): string {
  const stripped = html.replace(
    /<(nav|header|footer|aside|form|svg|iframe|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(stripped)?.[2];
  return main && main.length > 500 ? main : stripped;
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  try {
    // Dynamic: pdf.js installs DOM globals at module scope, so it must not be
    // dragged into every request that merely imports the web tools.
    const { extractPdfText } = await import("./pdf");
    const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
    const text = await extractPdfText(dataUrl);
    return text === PDF_NO_TEXT
      ? "(this PDF is a scan with no text layer, so there is nothing to read)"
      : text;
  } catch (e) {
    return `(could not read this PDF: ${String(e).slice(0, 200)})`;
  }
}

/** Read a response body up to `limit` bytes, then stop — bounds memory use. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
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
  return concatChunks(chunks);
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
