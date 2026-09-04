/**
 * Embeddings for semantic retrieval.
 *
 * This used to demand a second API key on the belief that OpenRouter did not
 * serve embeddings. It does — POST /api/v1/embeddings, the same key and the
 * same base URL as everything else — so the default path now needs nothing but
 * the key the user already gave us, and the separate endpoint is an override
 * for people who want a local model or a provider of their own.
 *
 * It stays behind a switch rather than being always-on, because indexing a
 * knowledge base costs real money and a feature that quietly spends is worse
 * than one you have to turn on.
 *
 * When it is off or unreachable, nothing breaks. Retrieval falls back to the
 * lexical scorer, which is what shipped before this existed — a knowledge base
 * that silently stops working because a key expired would be far worse than one
 * that quietly gets less clever.
 */

import { getApiKey, getSetting } from "./db";
import { OPENROUTER_BASE } from "./openrouter-base";

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** An embedding model OpenRouter serves, so the default needs no extra setup. */
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * The endpoint to embed against, or null when semantic retrieval is off.
 *
 * Two ways to be configured, in order:
 *
 *   1. An explicit endpoint and key — a local Ollama, LM Studio, OpenAI direct.
 *      Having entered one is itself the opt-in; no switch needed.
 *   2. The switch, using the OpenRouter key already on the account.
 *
 * Null means "use the lexical scorer", which every caller handles.
 */
export async function embeddingConfig(userId?: string): Promise<EmbeddingConfig | null> {
  const model = (await getSetting("embedding_model", userId)) || DEFAULT_EMBEDDING_MODEL;
  const ownKey = ((await getSetting("embedding_api_key", userId)) || "").trim();

  if (ownKey) {
    const base = (await getSetting("embedding_base_url", userId)) || OPENROUTER_BASE;
    return { baseUrl: base.replace(/\/+$/, ""), apiKey: ownKey, model };
  }

  if ((await getSetting("embedding_enabled", userId)) !== "1") return null;

  // No separate key: spend the one the user already gave us.
  const key = await getApiKey(userId);
  if (!key) return null;
  return { baseUrl: OPENROUTER_BASE, apiKey: key, model };
}

/** Batched so a large upload is a handful of requests rather than one per chunk. */
const BATCH = 64;

/**
 * Embed texts in order. Returns null on any failure rather than throwing:
 * every caller has a lexical path to fall back to, and a retrieval upgrade
 * should never be able to fail a chat turn.
 */
export async function embed(
  texts: string[],
  cfg: EmbeddingConfig
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const res = await fetch(cfg.baseUrl + "/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.apiKey,
        },
        body: JSON.stringify({ model: cfg.model, input: slice }),
      });
      if (!res.ok) {
        console.error(
          "[liberde] embeddings failed:",
          res.status,
          (await res.text().catch(() => "")).slice(0, 200)
        );
        return null;
      }
      const data = (await res.json()) as {
        data?: { index?: number; embedding?: number[] }[];
      };
      const rows = data.data ?? [];
      if (rows.length !== slice.length) return null;
      // The spec allows results out of order, so trust `index` when present.
      const ordered: number[][] = new Array(slice.length);
      rows.forEach((r, n) => {
        const at = typeof r.index === "number" ? r.index : n;
        if (Array.isArray(r.embedding)) ordered[at] = r.embedding;
      });
      if (ordered.some((v) => !Array.isArray(v))) return null;
      out.push(...ordered);
    }
    return out;
  } catch (e) {
    console.error("[liberde] embeddings error:", String(e).slice(0, 200));
    return null;
  }
}

/**
 * Cosine similarity of two equal-length vectors.
 *
 * Embedding APIs return unit vectors, so the denominator is usually 1 and this
 * is really a dot product — but it is computed properly anyway, because a
 * local model behind a custom endpoint is under no obligation to normalise.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
