import { getApiKey } from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { openRouterHeaders, OPENROUTER_BASE } from "@/lib/openrouter";

/** Live account status for the configured OpenRouter key: credits + key limits. */
export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  if (!(await getApiKey(userId))) {
    return Response.json({ hasApiKey: false });
  }
  try {
    const headers = await openRouterHeaders(userId);
    const [keyRes, creditsRes] = await Promise.all([
      fetch(`${OPENROUTER_BASE}/key`, { headers }),
      fetch(`${OPENROUTER_BASE}/credits`, { headers }),
    ]);
    const key = keyRes.ok ? (await keyRes.json()).data : null;
    const credits = creditsRes.ok ? (await creditsRes.json()).data : null;
    return Response.json({
      hasApiKey: true,
      label: key?.label ?? null,
      isFreeTier: key?.is_free_tier ?? null,
      keyUsage: key?.usage ?? null,
      keyLimit: key?.limit ?? null,
      totalCredits: credits?.total_credits ?? null,
      totalUsage: credits?.total_usage ?? null,
    });
  } catch (e) {
    return Response.json({ hasApiKey: true, error: String(e) }, { status: 502 });
  }
}
