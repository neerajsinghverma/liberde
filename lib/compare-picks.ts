/**
 * Choosing which models a Second opinion should default to.
 *
 * Pure, and in lib/ rather than inside the panel, because the first version of
 * this shipped two bugs that a person had to notice in a screenshot: the Auto
 * sentinel appearing as a callable model, and "Claude 3 Haiku" being picked
 * ahead of every newer Claude. Both came from the same place — the catalog
 * arrives sorted by *name*, so "the first match" meant "the alphabetically
 * first match". Neither was visible to a typecheck, a build, or a route audit.
 * Here they are testable.
 */

import type { ModelInfo } from "./types";

/** The Auto router is a routing instruction, not an endpoint — it can't be called. */
export const AUTO_SENTINEL = "auto";

/**
 * Families, in the order a default set considers them. This decides *sequence*,
 * not uniqueness: see vendorOf for why those are different questions.
 */
export const FAMILIES: [RegExp, string][] = [
  [/^anthropic\/claude/, "claude"],
  [/^openai\/gpt-5/, "gpt5"],
  [/^openai\/(gpt-4|o[13])/, "gpt4"],
  [/^google\/gemini/, "gemini"],
  [/^x-ai\/grok/, "grok"],
  [/^deepseek\//, "deepseek"],
  [/^meta-llama\//, "llama"],
  [/^mistralai\//, "mistral"],
];

export function familyOf(id: string): string {
  for (const [re, fam] of FAMILIES) if (re.test(id)) return fam;
  return id.split("/")[0] || id;
}

/**
 * The lab behind a model.
 *
 * Distinct from the family on purpose: `openai/gpt-5` and `openai/o3` are two
 * families but one lab, and three answers from one lab is not a second opinion.
 * Uniqueness is enforced on this.
 */
export function vendorOf(id: string): string {
  return id.split("/")[0] || id;
}

/** Worth putting in a comparison: real, callable, and answered promptly. */
export function comparable(m: Pick<ModelInfo, "id">, current: string): boolean {
  if (m.id === AUTO_SENTINEL) return false;
  // A batch variant is cheaper because it is *not* answered promptly. Racing
  // one against two live models compares latency, not answers.
  if (m.id.includes(":batch")) return false;
  return m.id !== current;
}

/** Newest first. Recency is the best cheap proxy for "the current one". */
export function byNewest(a: Pick<ModelInfo, "created">, b: Pick<ModelInfo, "created">): number {
  return (b.created || 0) - (a.created || 0);
}

/**
 * The price percentile above which a model is too dear to *suggest*.
 *
 * A comparison runs three models on one question, so the default set costs
 * roughly three turns. Picking purely by recency reached the top of the
 * catalog — Claude Fable 5.1 and GPT-6 Astra at $50 per million output tokens —
 * which is a lot to spend on a second opinion nobody asked to be expensive.
 * At the 95th percentile the ceiling lands just above Opus-tier and just below
 * the flagships, which is the right default: current, capable, not extravagant.
 *
 * It only constrains what is *suggested*. Anything in the catalog can still be
 * chosen deliberately from the picker.
 */
export const SUGGEST_PRICE_PERCENTILE = 0.95;

/** Completion price per token, or NaN when the model reports none. */
function completionPrice(m: Pick<ModelInfo, "pricing">): number {
  const n = Number(m.pricing?.completion);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * The dearest price a suggested model may have, from the live catalog rather
 * than a hardcoded figure — model prices move, and a fixed dollar amount would
 * be wrong within a month.
 *
 * Returns Infinity for a catalog too small to have meaningful bands, because
 * excluding the top of a five-model list would leave nothing to compare.
 */
export function suggestPriceCeiling(
  models: Pick<ModelInfo, "pricing">[],
  percentile = SUGGEST_PRICE_PERCENTILE
): number {
  const priced = models
    .map(completionPrice)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (priced.length < 8) return Infinity;
  // Nearest-rank over indices 0..n-1. Multiplying the *length* instead puts
  // the 95th percentile of a ten-model list on the tenth model — the ceiling
  // becomes the maximum and excludes nothing, which is the opposite of the
  // intent on exactly the small catalogs where it matters most.
  return priced[Math.floor((priced.length - 1) * percentile)];
}

/**
 * The default comparison set: the current model, plus the newest model from
 * each of two other labs.
 *
 * Spanning labs is the whole point of the feature. Within a lab, the newest
 * release the ceiling allows is almost always what the person meant — the very
 * top of the catalog is a deliberate choice, not a default.
 */
export function suggestDefaults(models: ModelInfo[], current: string): string[] {
  const seed = current && current !== AUTO_SENTINEL ? [current] : [];
  const picks = [...seed];
  const usedVendors = new Set(picks.map(vendorOf));
  // Newest first, but not at any price: see suggestPriceCeiling.
  const ceiling = suggestPriceCeiling(models);
  const ranked = models
    .filter((m) => comparable(m, current))
    .filter((m) => {
      const price = Number(m.pricing?.completion);
      // A model with no published price is not evidence of a cheap one, but
      // excluding it would drop whole labs on a sparse catalog. Keep it.
      return !Number.isFinite(price) || price <= 0 || price <= ceiling;
    })
    .sort(byNewest);

  for (const [re] of FAMILIES) {
    if (picks.length >= 3) break;
    const m = ranked.find(
      (x) => re.test(x.id) && !picks.includes(x.id) && !usedVendors.has(vendorOf(x.id))
    );
    if (m) {
      picks.push(m.id);
      usedVendors.add(vendorOf(m.id));
    }
  }

  // Still short: a small or unusual catalog. Fill with the newest that are
  // left, still one per lab, rather than whatever sorts first by name.
  for (const m of ranked) {
    if (picks.length >= 3) break;
    if (picks.includes(m.id) || usedVendors.has(vendorOf(m.id))) continue;
    picks.push(m.id);
    usedVendors.add(vendorOf(m.id));
  }

  return picks.slice(0, 4);
}
