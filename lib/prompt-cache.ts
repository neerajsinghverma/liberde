/**
 * Prompt caching across OpenRouter's provider fleet.
 *
 * Providers fall into two camps (openrouter.ai/docs/features/prompt-caching):
 *
 *  - **Automatic** — OpenAI, DeepSeek, Grok, Groq, Moonshot, Z.AI, and Gemini's
 *    implicit cache. Nothing to send; the discount lands on its own.
 *  - **Explicit** — Anthropic and Qwen cache ONLY where a `cache_control`
 *    breakpoint is placed. Without one they re-bill the entire prompt every
 *    single turn, which is why this file exists.
 *
 * Both camps are *prefix* matches: one changed byte invalidates everything
 * after it. So the flag is the easy half — the real work is keeping the prefix
 * byte-identical between turns, which is why the chat route splits its system
 * prompt into a stable head and a volatile tail rather than one blob.
 */

/**
 * Model families that need an explicit breakpoint. Everything else either
 * caches automatically or doesn't cache at all; in both cases sending
 * `cache_control` would be noise.
 */
const EXPLICIT_CACHE_FAMILY = /^(anthropic|qwen)\//;

/** Strip OpenRouter's "~" floating-alias prefix (e.g. "~anthropic/claude-sonnet-latest"). */
const bareModel = (model: string) => model.replace(/^~/, "");

/**
 * True when this model bills the full prompt unless we mark a breakpoint.
 * Non-OpenRouter targets are excluded: the external clouds speak plain
 * OpenAI dialect and reject the Anthropic-shaped `cache_control` field.
 */
export function needsExplicitCacheControl(model: string, isOpenRouter: boolean): boolean {
  return isOpenRouter && EXPLICIT_CACHE_FAMILY.test(bareModel(model));
}

type CacheControl = { type: "ephemeral"; ttl?: "5m" | "1h" };

interface TextPart {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}
type AnyPart = TextPart | { type: string; [k: string]: unknown };

interface CacheableMessage {
  role: string;
  content: string | AnyPart[] | null;
  tool_calls?: unknown[];
}

/**
 * Mark `msg` as a cache breakpoint: everything from the start of the request
 * through this message becomes the cached prefix.
 *
 * A string body is promoted to a one-element parts array, since `cache_control`
 * rides on a content block rather than the message. Messages with no text part
 * to hang it on (a bare tool call) are left alone rather than reshaped — a
 * malformed breakpoint costs a whole turn, a missing one costs a discount.
 */
export function markCacheBreakpoint(msg: CacheableMessage, ttl?: "1h"): boolean {
  const control: CacheControl = ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" };

  if (typeof msg.content === "string" && msg.content.length > 0) {
    msg.content = [{ type: "text", text: msg.content, cache_control: control }];
    return true;
  }
  if (Array.isArray(msg.content)) {
    // Anthropic reads the breakpoint off the final block, so anchor it there.
    const lastText = [...msg.content].reverse().find((p) => p.type === "text") as
      | TextPart
      | undefined;
    if (lastText) {
      lastText.cache_control = control;
      return true;
    }
  }
  return false;
}

/**
 * Place breakpoints on an assembled request. Anthropic allows four; two earn
 * their keep here:
 *
 *  1. The **stable system head** — the artifact/analysis/tool protocol blocks.
 *     Identical on every turn of every conversation, so this one always hits.
 *  2. The **last user turn** — makes the growing conversation cache
 *     incrementally, so turn N+1 reads the history turn N already paid to write.
 *
 * Anything volatile (today's date, memory, per-query project knowledge) must
 * already be positioned after the second breakpoint by the caller, or it
 * invalidates the very prefix we're trying to reuse.
 *
 * Below the provider's minimum cacheable prefix (~1024 tokens) a breakpoint is
 * silently ignored upstream — no write, no charge — so there's no size guard.
 */
export function applyPromptCache(
  messages: CacheableMessage[],
  opts: { model: string; isOpenRouter: boolean }
): void {
  // Clear first, so this is idempotent and safe to re-run when a turn
  // switches models mid-flight: stale breakpoints would otherwise pile up
  // against Anthropic's limit of four, or ride along to a provider that
  // never asked for them.
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) delete (part as TextPart).cache_control;
  }
  if (!needsExplicitCacheControl(opts.model, opts.isOpenRouter)) return;

  const head = messages.find((m) => m.role === "system");
  if (head) markCacheBreakpoint(head);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser && lastUser !== head) markCacheBreakpoint(lastUser);
}

export interface CacheStats {
  /** Prompt tokens served from cache at ~0.1x (Anthropic) or ~0.25x (others). */
  cachedTokens: number;
  /** USD OpenRouter reports as saved on this call. */
  discount: number;
}

/**
 * Read cache accounting off an OpenRouter usage payload. Field names differ by
 * provider, so both spellings are checked. `cache_discount` can come back
 * negative on a cache *write* (writes cost 1.25x) — that's real and kept as-is
 * so the reported total stays honest about the warm-up turn.
 */
export function readCacheStats(usage: unknown): CacheStats {
  const u = (usage ?? {}) as {
    cache_discount?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
  return {
    cachedTokens: Number(u.prompt_tokens_details?.cached_tokens) || 0,
    discount: Number(u.cache_discount) || 0,
  };
}

/**
 * OpenRouter load-balances across upstream providers, and a cache lives on
 * exactly one of them — land on a different provider next turn and the prefix
 * you paid to write is simply gone. Passing a stable session id pins the
 * conversation to one provider so the cache is actually reachable.
 * Capped at OpenRouter's 256-character limit.
 */
export function cacheSessionId(conversationId: string): string {
  return conversationId.slice(0, 256);
}
