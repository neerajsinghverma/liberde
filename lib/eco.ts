// Rough environmental-impact estimates for LLM usage.
//
// No provider publishes per-inference energy, so everything here is an
// order-of-magnitude estimate: generation (output tokens) dominates, weighted
// by a model-size tier, then converted to CO2e with a world-average grid
// intensity. Treat the results as honest ballparks, never as measurements —
// any UI showing them should say so.

// Wh per 1k output tokens by model tier. Anchored to public estimates of
// ~0.3 Wh for a typical mid-size-model reply (~500 output tokens).
const WH_PER_1K_OUT: Record<Tier, number> = { small: 0.05, mid: 0.5, large: 1.5 };

// Prefill is batched and far cheaper per token than generation.
const INPUT_WEIGHT = 0.1;

// World-average grid carbon intensity, gCO2e per kWh. Regional grids vary 10x+
// around this, which is the biggest source of uncertainty in the whole estimate.
export const GRID_G_PER_KWH = 400;

export type Tier = "small" | "mid" | "large";

const SMALL_RE = /haiku|mini|nano|flash|lite|tiny|gemma|phi-|-7b|-8b|-9b|-3b|-4b|-1b/i;
const LARGE_RE = /opus|fable|mythos|gpt-5|o1|o3|grok-4|ultra|deepseek-r1|reason|think/i;

export function modelTier(model?: string | null): Tier {
  if (!model) return "mid";
  if (SMALL_RE.test(model)) return "small";
  if (LARGE_RE.test(model)) return "large";
  return "mid";
}

export function estimateWh(
  tokensIn: number,
  tokensOut: number,
  model?: string | null
): number {
  const weighted = tokensOut + tokensIn * INPUT_WEIGHT;
  return (weighted / 1000) * WH_PER_1K_OUT[modelTier(model)];
}

export function co2Grams(wh: number): number {
  return (wh / 1000) * GRID_G_PER_KWH;
}

export function fmtWh(wh: number): string {
  if (wh < 0.1) return "<0.1 Wh";
  if (wh < 1000) return `${wh < 10 ? wh.toFixed(1) : Math.round(wh)} Wh`;
  return `${(wh / 1000).toFixed(1)} kWh`;
}

export function fmtCo2(g: number): string {
  if (g < 0.1) return "<0.1 g";
  if (g < 1000) return `${g < 10 ? g.toFixed(1) : Math.round(g)} g`;
  return `${(g / 1000).toFixed(1)} kg`;
}

// A relatable comparison at the right scale: a phone charge is ~15 Wh,
// boiling one cup of tea ~33 Wh.
export function ecoEquivalence(wh: number): string {
  if (wh < 15) {
    const pct = Math.max(1, Math.round((wh / 15) * 100));
    return `≈ ${pct}% of one phone charge`;
  }
  if (wh < 100) return `≈ ${(wh / 15).toFixed(1)} phone charges`;
  const cups = wh / 33;
  return `≈ boiling ${cups >= 10 ? Math.round(cups) : cups.toFixed(1)} cups of tea`;
}
