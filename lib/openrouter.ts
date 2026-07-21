import { getApiKey, getSetting } from "./db";
import type { Attachment, Message, ModelInfo } from "./types";
import { retrieveRelevant } from "./rag";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
export const DEFAULT_TITLE_MODEL = "openai/gpt-4o-mini";

/** Detects a value pasted into the API-key field that clearly isn't an
 *  OpenRouter key (wrong text, non-ASCII characters that would even crash the
 *  auth header). Returns a user-facing message, or null when it looks fine. */
export function keyProblem(key: string): string | null {
  const k = (key ?? "").trim();
  if (!k) return null; // "missing key" is handled separately
  if (!/^[\x20-\x7E]+$/.test(k)) {
    return "Your API key contains invalid characters — it looks like something other than a key got pasted into that field. Re-enter your key in Settings → General and click Verify.";
  }
  if (!/^sk-or-/.test(k) || k.length > 120) {
    return "That doesn't look like an OpenRouter key (they start with 'sk-or-'). Re-enter it in Settings → General and click Verify.";
  }
  return null;
}

export async function openRouterHeaders(
  userId?: string
): Promise<Record<string, string>> {
  const key = await getApiKey(userId);
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Liberde",
  };
}

export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image";

export async function getSettings(userId?: string) {
  return {
    defaultModel: (await getSetting("default_model", userId)) || DEFAULT_MODEL,
    titleModel: (await getSetting("title_model", userId)) || DEFAULT_TITLE_MODEL,
    imageModel: (await getSetting("image_model", userId)) || DEFAULT_IMAGE_MODEL,
    /** Audio-capable model used for voice dictation (speech-to-text). */
    transcribeModel: (await getSetting("transcribe_model", userId)) || "google/gemini-2.5-flash",
    /** Cheap model for planning (agent/research); "" = use the conversation's model. */
    plannerModel: (await getSetting("planner_model", userId)) || "",
    /** Model that executes agent steps; "" = use the conversation's model. */
    agentExecModel: (await getSetting("agent_exec_model", userId)) || "",
    systemPrompt: (await getSetting("system_prompt", userId)) || "",
    aboutUser: (await getSetting("about_user", userId)) || "",
    styleInstructions: (await getSetting("style_instructions", userId)) || "",
    /** Built-in response style preset: normal | concise | explanatory | formal | learning */
    responseStyle: (await getSetting("response_style", userId)) || "normal",
    memoryEnabled: (await getSetting("memory_enabled", userId)) !== "0",
    monthlyBudget: Number((await getSetting("monthly_budget", userId)) ?? "0") || 0,
    temperature: Number((await getSetting("temperature", userId)) ?? "1"),
  };
}

/** Built-in response styles (like Claude's Concise/Explanatory/Formal). The
 *  directive is prepended to the system prompt; "custom" defers to the user's
 *  own styleInstructions. */
export const STYLE_PRESETS: Record<string, { label: string; directive: string }> = {
  normal: { label: "Normal", directive: "" },
  concise: {
    label: "Concise",
    directive:
      "Response style: be concise and direct. Lead with the answer, use short sentences, skip preamble and filler.",
  },
  explanatory: {
    label: "Explanatory",
    directive:
      "Response style: be thorough and educational — explain your reasoning, give context, and include brief examples.",
  },
  formal: {
    label: "Formal",
    directive:
      "Response style: formal and professional — complete sentences, precise wording, no slang or emoji.",
  },
  learning: {
    label: "Learning",
    directive:
      "Response style: act as a patient tutor. Guide with questions and step-by-step explanations, checking understanding, rather than just handing over the final answer.",
  },
};

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface ChatCompletionMessage {
  role: string;
  content: string | ContentPart[] | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/** Convert a stored message (with attachments/tool data) into OpenAI chat format. */
export function toApiMessage(
  msg: Message,
  opts: { pdfAsText?: boolean } = {}
): ChatCompletionMessage {
  if (msg.role === "tool") {
    return { role: "tool", tool_call_id: msg.tool_call_id ?? "", content: msg.content };
  }
  if (msg.role === "assistant" && msg.tool_calls?.length) {
    return {
      role: "assistant",
      content: msg.content || null,
      tool_calls: msg.tool_calls,
    };
  }
  const attachments = msg.attachments ?? [];
  const images = attachments.filter(
    (a) => a.dataUrl && a.mime.startsWith("image/")
  );
  // For providers without native PDF support, extracted text stands in for the file.
  const pdfs = attachments.filter(
    (a) => a.dataUrl && a.mime === "application/pdf" && !(opts.pdfAsText && a.text != null)
  );
  const textFiles = attachments.filter(
    (a) =>
      a.text != null && (a.mime !== "application/pdf" || Boolean(opts.pdfAsText))
  );

  let text = msg.content;
  if (textFiles.length > 0) {
    const fileBlocks = textFiles
      .map((f) => `<attached_file name="${f.name}">\n${f.text}\n</attached_file>`)
      .join("\n\n");
    text = `${fileBlocks}\n\n${text}`;
  }

  if (images.length === 0 && pdfs.length === 0) {
    return { role: msg.role, content: text };
  }

  const parts: ContentPart[] = [
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.dataUrl! },
    })),
    ...pdfs.map((pdf) => ({
      type: "file" as const,
      file: { filename: pdf.name, file_data: pdf.dataUrl! },
    })),
  ];
  parts.push({ type: "text", text });
  return { role: msg.role, content: parts };
}

/** True when any message in the history carries a PDF attachment. */
export function historyHasPdf(messages: Message[]): boolean {
  return messages.some((m) =>
    m.attachments?.some((a) => a.mime === "application/pdf" && a.dataUrl)
  );
}

export function buildSystemPrompt(
  globalPrompt: string,
  project?: { instructions: string; files: { name: string; content: string }[] } | null,
  personalization?: { aboutUser: string; styleInstructions: string } | null,
  query?: string
): string {
  const parts: string[] = [];
  if (globalPrompt.trim()) parts.push(globalPrompt.trim());
  if (personalization) {
    const p: string[] = [];
    if (personalization.aboutUser.trim()) {
      p.push(`About the user:\n${personalization.aboutUser.trim()}`);
    }
    if (personalization.styleInstructions.trim()) {
      p.push(`How the user wants you to respond:\n${personalization.styleInstructions.trim()}`);
    }
    if (p.length) parts.push(`# User personalization\n\n${p.join("\n\n")}`);
  }
  if (project) {
    if (project.instructions.trim()) {
      parts.push(`<project_instructions>\n${project.instructions.trim()}\n</project_instructions>`);
    }
    if (project.files.length > 0) {
      // Retrieve the chunks most relevant to the query rather than dumping all.
      const selected = retrieveRelevant(project.files, query ?? "");
      const knowledge = selected
        .map((c) => `<document name="${c.name}">\n${c.text}\n</document>`)
        .join("\n\n");
      parts.push(`<project_knowledge>\n${knowledge}\n</project_knowledge>`);
    }
  }
  return parts.join("\n\n");
}

// Transient upstream statuses worth retrying (rate limits + gateway/5xx).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number) =>
  Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);

/**
 * fetch() with exponential-backoff retries on transient network/5xx/429 errors
 * and an optional per-attempt timeout. Retries do NOT fire when the caller's
 * `signal` aborts (client disconnect / deliberate cancel). On a retryable HTTP
 * status the response body is discarded before the next attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Response> {
  const { retries = 2, timeoutMs, signal } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // Caller cancelled (not our per-attempt timeout) → surface immediately.
      if (signal?.aborted) throw e;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr;
}

/** Non-streaming completion, used for title generation and utility calls. */
export async function complete(
  model: string,
  messages: ChatCompletionMessage[],
  opts: { temperature?: number; max_tokens?: number; timeoutMs?: number } = {},
  userId?: string
): Promise<string> {
  const { timeoutMs = 45_000, ...body } = opts;
  const res = await fetchWithRetry(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      method: "POST",
      headers: await openRouterHeaders(userId),
      body: JSON.stringify({ model, messages, stream: false, ...body }),
    },
    { retries: 2, timeoutMs }
  );
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

let modelCache: { at: number; models: ModelInfo[] } | null = null;

export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) {
    return modelCache.models;
  }
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const models: ModelInfo[] = (data.data ?? []).map(
    (m: {
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
      created?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      supported_parameters?: string[];
    }) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description ?? "",
      context_length: m.context_length ?? 0,
      created: m.created ?? 0,
      pricing: {
        prompt: m.pricing?.prompt ?? "0",
        completion: m.pricing?.completion ?? "0",
      },
      supportsImages: m.architecture?.input_modalities?.includes("image") ?? false,
      supportsTools: m.supported_parameters?.includes("tools") ?? false,
      outputsImages: m.architecture?.output_modalities?.includes("image") ?? false,
    })
  );
  models.sort((a, b) => a.name.localeCompare(b.name));
  modelCache = { at: Date.now(), models };
  return models;
}

/** Model context window in tokens; falls back to a safe default when unknown
 *  (external providers, lookup failure). */
export async function getContextLimit(model: string): Promise<number> {
  try {
    const models = await listModels();
    const found = models.find((m) => m.id === model)?.context_length;
    return found && found > 0 ? found : 128_000;
  } catch {
    return 128_000;
  }
}

// Rough token estimate: ~4 chars/token is close enough for budgeting.
const estTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);
const msgTokens = (m: ChatCompletionMessage) =>
  estTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")) +
  (m.tool_calls ? estTokens(JSON.stringify(m.tool_calls)) : 0) +
  4; // per-message overhead

/**
 * Drop the oldest non-system messages in place until the estimated prompt fits
 * `contextLimit - reserveForOutput`. Leading system messages are always kept,
 * and the cut boundary is sanitized so history never starts with an orphan
 * `tool` result or an `assistant` message whose tool results were trimmed away
 * (either would make the provider reject the request). Returns how many were
 * removed. Never trims below the most recent turn.
 */
export function fitContextInPlace(
  messages: ChatCompletionMessage[],
  contextLimit: number,
  reserveForOutput = 4000
): { trimmed: number } {
  const budget = Math.max(4000, contextLimit - reserveForOutput);
  const total = () => messages.reduce((n, m) => n + msgTokens(m), 0);
  if (total() <= budget) return { trimmed: 0 };

  let sys = 0;
  while (sys < messages.length && messages[sys].role === "system") sys++;

  let trimmed = 0;
  while (total() > budget && messages.length - sys > 2) {
    messages.splice(sys, 1);
    trimmed++;
  }
  // Never begin the post-system history on a dangling tool/assistant-tool_calls.
  while (
    messages.length > sys &&
    (messages[sys].role === "tool" ||
      (messages[sys].role === "assistant" && messages[sys].tool_calls))
  ) {
    messages.splice(sys, 1);
    trimmed++;
  }
  return { trimmed };
}

export function attachmentsFromUpload(
  files: { name: string; mime: string; base64: string }[]
): Attachment[] {
  return files.map((f) => {
    if (f.mime.startsWith("image/")) {
      return { name: f.name, mime: f.mime, dataUrl: `data:${f.mime};base64,${f.base64}` };
    }
    return {
      name: f.name,
      mime: f.mime,
      text: Buffer.from(f.base64, "base64").toString("utf-8"),
    };
  });
}
