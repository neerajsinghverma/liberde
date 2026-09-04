/**
 * Embeddings for semantic retrieval.
 *
 * Deliberately configured separately from the chat model. OpenRouter does not
 * serve embeddings, so the one key that powers everything else cannot power
 * this: it needs its own OpenAI-compatible endpoint, which may be OpenAI
 * itself, a local Ollama, an LM Studio, or anything else speaking /embeddings.
 *
 * When it is not configured, nothing breaks. Retrieval falls back to the
 * lexical scorer, which is what shipped before this existed — a knowledge base
 * that silently stops working because a key expired would be far worse than one
 * that quietly gets less clever.
 */

import { getSetting } from "./db";

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Null when the user has not set an embeddings endpoint up. */
export async function embeddingConfig(userId?: string): Promise<EmbeddingConfig | null> {
  const apiKey = (await getSetting("embedding_api_key", userId)) || "";
  if (!apiKey.trim()) return null;
  return {
    baseUrl: ((await getSetting("embedding_base_url", userId)) || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ""
    ),
    apiKey: apiKey.trim(),
    model: (await getSetting("embedding_model", userId)) || DEFAULT_EMBEDDING_MODEL,
  };
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
