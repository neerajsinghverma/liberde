import { OPENROUTER_BASE } from "@/lib/openrouter";

let cache: { at: number; ids: string[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 10 * 60 * 1000) {
      const res = await fetch(`${OPENROUTER_BASE}/models?output_modalities=image`);
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const data = await res.json();
      cache = {
        at: Date.now(),
        ids: (data.data ?? []).map((m: { id: string }) => m.id).sort(),
      };
    }
    return Response.json(cache.ids);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
