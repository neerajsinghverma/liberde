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
 * The default comparison set: the current model, plus the newest model from
 * each of two other labs.
 *
 * Spanning labs is the whole point of the feature. Within a lab, the newest
 * release is almost always what the person meant.
 */
export function suggestDefaults(models: ModelInfo[], current: string): string[] {
  const seed = current && current !== AUTO_SENTINEL ? [current] : [];
  const picks = [...seed];
  const usedVendors = new Set(picks.map(vendorOf));
  const ranked = models.filter((m) => comparable(m, current)).sort(byNewest);

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
