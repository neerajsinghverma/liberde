import { getApiKey, getSetting } from "./db";
import { PDF_NO_TEXT, type Attachment, type Message, type ModelInfo } from "./types";
import { retrieveRelevant, retrieveSemantic } from "./rag";

export { OPENROUTER_BASE } from "./openrouter-base";
import { OPENROUTER_BASE } from "./openrouter-base";

// Fallback model for users who haven't picked one (i.e. new signups). The "~"
// prefix is OpenRouter's floating alias that always tracks the latest GPT Mini.
// Cheap, fast general-purpose default; users can change it in Settings any time.
export const DEFAULT_MODEL = "~openai/gpt-mini-latest";
export const DEFAULT_TITLE_MODEL = "openai/gpt-4o-mini";

/** Sentinel model id for intelligent per-message routing ("Auto" in the picker). */
export const AUTO_MODEL = "auto";

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
    /** Let the model search the user's own past chats (default on; toggleable). */
    recallEnabled: (await getSetting("recall_enabled", userId)) !== "0",
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

/** True when a PDF attachment carries extracted text with actual content in it. */
function hasUsableText(a: { text?: string }): boolean {
  return a.text != null && a.text !== PDF_NO_TEXT;
}

/** Convert a stored message (with attachments/tool data) into OpenAI chat format. */
export function toApiMessage(
  msg: Message,
  /**
   * `rawPdfFallback` attaches the raw PDF as a `file` part when local extraction
   * produced nothing usable, so a provider-side parser can try. OpenRouter only
   * — plain OpenAI-dialect endpoints reject `file` parts.
   */
  opts: { rawPdfFallback?: boolean } = {}
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
  // Locally extracted text stands in for the file on every provider. Only when
  // extraction found nothing does the raw file go out for a provider-side parse.
  const pdfs = attachments.filter(
    (a) =>
      a.dataUrl &&
      a.mime === "application/pdf" &&
      !hasUsableText(a) &&
      Boolean(opts.rawPdfFallback)
  );
  const textFiles = attachments.filter(
    (a) => a.mime === "application/pdf" ? hasUsableText(a) : a.text != null
  );
  // An upload we couldn't parse must not simply vanish, or the model answers as
  // though nothing was attached — which is how a silent extraction failure turns
  // into a confidently wrong reply. Name it and say it was unreadable.
  const unreadable = attachments.filter(
    (a) =>
      a.dataUrl &&
      a.text == null &&
      !a.mime.startsWith("image/") &&
      !pdfs.includes(a)
  );

  let text = msg.content;
  const blocks = [
    ...textFiles.map(
      (f) => `<attached_file name="${f.name}">\n${f.text}\n</attached_file>`
    ),
    ...unreadable.map(
      (f) =>
        `<attached_file name="${f.name}" status="unreadable">The user attached this file but it could not be parsed. Tell them so rather than guessing at its contents.</attached_file>`
    ),
  ];
  if (blocks.length > 0) {
    text = `${blocks.join("\n\n")}\n\n${text}`;
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

/** True when any message in the history carries an uploaded file of `mime`. */
export function historyHasMime(messages: Message[], mime: string): boolean {
  return messages.some((m) => m.attachments?.some((a) => a.mime === mime && a.dataUrl));
}

/** True when any message in the history carries a PDF attachment. */
export function historyHasPdf(messages: Message[]): boolean {
  return historyHasMime(messages, "application/pdf");
}

/**
 * A short factual line telling the model today's date, so it doesn't fall back
 * to assuming its training-cutoff date. Injected into system prompts across the
 * app (chat, design, compare, agent/plan, research, scheduled tasks). Uses UTC
 * — good to within a timezone offset, which is all the model needs for "today".
 */
export function dateContextLine(): string {
  const d = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Today's date is ${d} (UTC).`;
}

/**
 * The user/project half of the system prompt, split by how often it changes.
 *
 * `stable` is byte-identical for every turn of a conversation, so it can sit
 * inside a prompt-cache prefix. `volatile` is not: today's date rolls over, and
 * project knowledge is re-retrieved against each new query. Keeping the two
 * apart is what makes caching land — one re-retrieved chunk inside the cached
 * head would invalidate every token after it, protocol prompts included.
 */
export async function buildSystemPromptParts(
  globalPrompt: string,
  project?: {
    id?: string;
    instructions: string;
    files: { name: string; content: string }[];
  } | null,
  personalization?: { aboutUser: string; styleInstructions: string } | null,
  query?: string,
  userId?: string
): Promise<{ stable: string; volatile: string }> {
  const stable: string[] = [];
  const volatile: string[] = [dateContextLine()];

  if (globalPrompt.trim()) stable.push(globalPrompt.trim());
  if (personalization) {
    const p: string[] = [];
    if (personalization.aboutUser.trim()) {
      p.push(`About the user:\n${personalization.aboutUser.trim()}`);
    }
    if (personalization.styleInstructions.trim()) {
      p.push(`How the user wants you to respond:\n${personalization.styleInstructions.trim()}`);
    }
    if (p.length) stable.push(`# User personalization\n\n${p.join("\n\n")}`);
  }
  if (project) {
    if (project.instructions.trim()) {
      stable.push(`<project_instructions>\n${project.instructions.trim()}\n</project_instructions>`);
    }
    if (project.files.length > 0) {
      // Semantic first, lexical when it is unavailable. See lib/rag.ts for why
      // the fallback is load-bearing rather than a formality.
      const semantic = project.id
        ? await retrieveSemantic(project.id, query ?? "", undefined, userId)
        : null;
      const selected = semantic ?? retrieveRelevant(project.files, query ?? "");
      const knowledge = selected
        .map((c) => `<document name="${c.name}">\n${c.text}\n</document>`)
        .join("\n\n");
      volatile.push(`<project_knowledge>\n${knowledge}\n</project_knowledge>`);
    }
  }
  return { stable: stable.join("\n\n"), volatile: volatile.join("\n\n") };
}

/** Both halves as one blob, for callers that don't split on cacheability. */
export async function buildSystemPrompt(
  globalPrompt: string,
  project?: {
    id?: string;
    instructions: string;
    files: { name: string; content: string }[];
  } | null,
  personalization?: { aboutUser: string; styleInstructions: string } | null,
  query?: string,
  userId?: string
): Promise<string> {
  const { stable, volatile } = await buildSystemPromptParts(
    globalPrompt,
    project,
    personalization,
    query,
    userId
  );
  return [volatile, stable].filter(Boolean).join("\n\n");
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

// ---------------------------------------------------------------------------
// Auto routing: pick the right model per message. Only ever invoked when the
// selected model is the AUTO_MODEL sentinel — an explicit model always bypasses
// this entirely.

const ROUTE_MAJOR = /^(anthropic|openai|google|x-ai|deepseek|meta-llama|mistralai|qwen)\//;
const routePrice = (m: ModelInfo) =>
  parseFloat(m.pricing?.completion || "0") * 1e6 || 0;

// The very cheapest models (lite/nano/8B/tiny variants) cannot reliably follow
// Liberde system prompts — they mangle the memory/tool syntax or confabulate
// the artifact instructions instead of just answering. Exclude them from
// routing entirely; the fast tier uses a proven brand-name mini.
const ROUTE_TINY = /(lite|nano|instant|tiny|micro|\b\d{1,2}b\b|-\d{1,2}b)/;
const PREFERRED_FAST = /(gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini|gpt-mini|o4-mini|haiku|gemini[a-z0-9.\- ]*flash)/;

export type Tier = "fast" | "balanced" | "deep";

/**
 * Derive fast/balanced/deep model ids from the live catalog.
 *
 * Tiers come from where a model sits in the *price* distribution, not from
 * pattern-matching its name. Name matching quietly rots: every vendor rename
 * drops a flagship out of the deep bucket with no error at all, and the catalog
 * gains models faster than any regex keeps up with. Price is the one signal
 * that stays meaningful as the catalog turns over — a provider charging
 * top-decile rates is telling you what tier it thinks the model is.
 *
 * The fast tier is the exception and still prefers a known-good mini: the
 * cheapest model clearing the tiny filter is not necessarily one that can
 * follow the artifact and memory protocols, and getting that wrong breaks a
 * turn rather than merely overspending on it.
 */
function deriveTiers(models: ModelInfo[]): Partial<Record<Tier, string>> {
  const idn = (m: ModelInfo) => (m.id + " " + m.name).toLowerCase();
  const pool = models.filter(
    (m) =>
      m.context_length > 0 &&
      ROUTE_MAJOR.test(m.id) &&
      m.supportsTools &&
      !ROUTE_TINY.test(idn(m))
  );
  if (pool.length === 0) return {};

  // Free and unpriced entries say nothing about tier, so they stay out of the
  // distribution — unless dropping them leaves too little left to rank.
  const priced = pool
    .filter((m) => routePrice(m) > 0)
    .sort((a, b) => routePrice(a) - routePrice(b));
  const ranked = priced.length >= 3 ? priced : pool;

  /** The model at a percentile of the price distribution. */
  const at = (fraction: number) =>
    ranked[Math.min(ranked.length - 1, Math.max(0, Math.round(fraction * (ranked.length - 1))))];

  // Deep takes the top decile rather than the single priciest entry: the very
  // top of the catalog is usually a niche specialist nobody wants for a chat
  // turn. Within that band, prefer the roomiest context window.
  const deepBand = ranked.slice(Math.floor(ranked.length * 0.9));
  const deep =
    [...deepBand].sort((a, b) => b.context_length - a.context_length)[0]?.id ?? at(1)?.id;

  const fastPreferred = pool
    .filter((m) => PREFERRED_FAST.test(idn(m)))
    .sort((a, b) => routePrice(a) - routePrice(b))[0]?.id;
  const fast = fastPreferred ?? at(0.1)?.id ?? DEFAULT_MODEL;
  const balanced = at(0.5)?.id ?? deep ?? fast;

  return { fast, balanced: balanced ?? fast, deep: deep ?? balanced ?? fast };
}

/**
 * Which tier a concrete model id belongs to, judged the same way the tiers were
 * derived. Lets a follow-up read the tier of the previous answer in the thread
 * instead of paying a classifier call to rediscover it.
 */
export function tierOfModel(model: string, models: ModelInfo[]): Tier | null {
  const found = models.find((m) => m.id === model);
  if (!found) return null;
  const price = routePrice(found);
  if (price <= 0) return null;
  const prices = models
    .filter((m) => ROUTE_MAJOR.test(m.id) && routePrice(m) > 0)
    .map(routePrice)
    .sort((a, b) => a - b);
  if (prices.length < 3) return null;
  // Quartile bands: cheapest quarter is fast, priciest quarter is deep. The
  // boundaries are inclusive at the bottom so a genuine mini never lands in
  // balanced on a small catalog, where a single model is a whole eighth of
  // the distribution.
  const rank = prices.filter((p) => p < price).length / prices.length;
  if (rank <= 0.25) return "fast";
  if (rank < 0.75) return "balanced";
  return "deep";
}

const TIER_SYS = [
  "Classify the user request to route it to the cheapest AI model tier that will still do a good job.",
  'Return ONLY minified JSON: {"tier":"fast|balanced|deep","reason":"<=6 words"}.',
  "fast = short/casual/simple lookups, quick edits, small talk.",
  "balanced = normal writing, explanations, everyday coding, summaries.",
  "deep = complex reasoning, hard math/algorithms, tricky debugging, long analysis, nuanced judgment.",
  "Prefer the cheapest tier that fits.",
].join(" ");

// Local signals strong enough to decide a tier without spending a round trip.
const CODE_FENCE = /```|\bstack trace\b|\bTraceback\b|\bexception\b/i;
const HARD_WORK =
  /\b(prove|derive|optimi[sz]e|refactor|architect|debug|why does|root cause|trade-?offs?|algorithm|complexity|benchmark|migrate)\b/i;
const LIGHT_WORK =
  /^(thanks|thank you|ok|okay|got it|nice|cool|perfect|yes|no|sure|hi|hello|hey)\b/i;

/**
 * Decide a tier from the message alone, or return null when the text genuinely
 * needs a model to judge it.
 *
 * Every null costs a full round trip to the classifier before the real request
 * even starts, so this layer is deliberately greedy: per-message routing is
 * only worth doing while it stays cheaper than not doing it.
 */
export function localTier(
  text: string,
  hasAttachment: boolean
): { tier: Tier; reason: string } | null {
  const t = text.trim();
  if (!t) {
    return hasAttachment
      ? { tier: "balanced", reason: "attachment to read" }
      : { tier: "fast", reason: "empty message" };
  }
  if (LIGHT_WORK.test(t) && t.length < 40) return { tier: "fast", reason: "acknowledgement" };
  // A long input is where a weak model is most obviously wasted, and the
  // classifier would only have read the first 1200 characters of it anyway.
  if (t.length > 4000) return { tier: "deep", reason: "long input" };
  if (HARD_WORK.test(t)) return { tier: "deep", reason: "hard reasoning" };
  if (CODE_FENCE.test(t)) return { tier: "balanced", reason: "code in the message" };
  // Length is the weakest signal, so it is asked last. A short message that
  // carries a stack trace or a snippet is not a trivial follow-up, and reading
  // brevity before content sent exactly those to the mini.
  if (t.length < 24 && !t.includes("?")) return { tier: "fast", reason: "quick follow-up" };
  return null;
}

/**
 * Choose a concrete model for one message. Local heuristics decide whenever
 * they can; the cheap classifier is asked only when they cannot. Never throws —
 * any failure falls back to a concrete default so a turn is never blocked by
 * the router itself.
 */
export async function routeModel(opts: {
  content: string;
  hasImage?: boolean;
  designMode?: boolean;
  /** Model of the last assistant turn in the thread — for stickiness. */
  priorModel?: string | null;
  settings: { defaultModel: string; titleModel: string };
  userId: string;
}): Promise<{ model: string; reason: string }> {
  let models: ModelInfo[] = [];
  try {
    models = await listModels();
  } catch {
    /* fall through to the fallback below */
  }
  const tiers = deriveTiers(models);
  const fallback =
    opts.settings.defaultModel && opts.settings.defaultModel !== AUTO_MODEL
      ? opts.settings.defaultModel
      : tiers.balanced || tiers.deep || DEFAULT_MODEL;

  // Ensure the picked model can accept image input when the turn has one.
  const ensureVision = (id: string, tier: Tier): string => {
    if (!opts.hasImage) return id;
    const chosen = models.find((m) => m.id === id);
    if (chosen?.supportsImages) return id;
    const vis = models.find(
      (m) =>
        ROUTE_MAJOR.test(m.id) &&
        m.supportsImages &&
        (tier === "deep" ? routePrice(m) >= routePrice(chosen ?? m) : true)
    );
    return vis?.id ?? id;
  };

  const text = (opts.content || "").trim();

  // Stickiness: a thread whose last answer came from a strong model must not
  // drop to the mini for a follow-up — it loses the depth of the thread and
  // tends to regenerate artifacts from scratch.
  const priorTier = opts.priorModel ? tierOfModel(opts.priorModel, models) : null;
  const clamp = (tier: Tier): Tier =>
    tier === "fast" && (priorTier === "balanced" || priorTier === "deep") ? "balanced" : tier;

  const pick = (tier: Tier, reason: string) => ({
    model: ensureVision(tiers[tier] || fallback, tier),
    reason,
  });

  if (opts.designMode) return pick("deep", "design work");

  // Layer 0 — local signals, no API call.
  const local = localTier(text, Boolean(opts.hasImage));
  if (local) {
    const tier = clamp(local.tier);
    return pick(tier, tier === local.tier ? local.reason : "follow-up in a detailed thread");
  }

  // Layer 1 — ask a cheap model, but only about the messages Layer 0 could not
  // place. The router model is always a concrete cheap model, never the AUTO
  // sentinel.
  try {
    const routerModel =
      opts.settings.titleModel && opts.settings.titleModel !== AUTO_MODEL
        ? opts.settings.titleModel
        : DEFAULT_TITLE_MODEL;
    const raw = await complete(
      routerModel,
      [
        { role: "system", content: TIER_SYS },
        { role: "user", content: text.slice(0, 1200) },
      ],
      { temperature: 0, max_tokens: 60, timeoutMs: 7000 },
      opts.userId
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const classified: Tier = ["fast", "balanced", "deep"].includes(j.tier) ? j.tier : "balanced";
    const tier = clamp(classified);
    return pick(
      tier,
      tier !== classified
        ? "follow-up in a detailed thread"
        : String(j.reason || tier).slice(0, 80)
    );
  } catch {
    return pick("balanced", "auto");
  }
}


export async function resolveAutoModel(
  id: string,
  opts: {
    content: string;
    hasImage?: boolean;
    designMode?: boolean;
    priorModel?: string | null;
    settings: { defaultModel: string; titleModel: string };
    userId: string;
  }
): Promise<{ model: string; routeReason: string | null }> {
  if (id !== AUTO_MODEL) return { model: id, routeReason: null };
  const routed = await routeModel(opts);
  return { model: routed.model, routeReason: routed.reason };
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
      supportsStructuredOutputs:
        m.supported_parameters?.includes("structured_outputs") ?? false,
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
