import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { OPENROUTER_BASE } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Validate a typed OpenRouter key against /key before the user saves it. */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  let key: string | undefined;
  try {
    ({ key } = await req.json());
  } catch {
    return Response.json({ valid: false, error: "Invalid body" }, { status: 400 });
  }
  if (!key || typeof key !== "string") {
    return Response.json({ valid: false, error: "No key provided" }, { status: 400 });
  }
  try {
    const res = await fetch(`${OPENROUTER_BASE}/key`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
    });
    if (!res.ok) {
      return Response.json({
        valid: false,
        status: res.status,
        error: res.status === 401 ? "Key rejected by OpenRouter" : `OpenRouter ${res.status}`,
      });
    }
    const data = (await res.json())?.data ?? {};
    return Response.json({
      valid: true,
      label: data.label ?? null,
      limit: data.limit ?? null,
      usage: data.usage ?? null,
    });
  } catch (e) {
    return Response.json({ valid: false, error: e instanceof Error ? e.message : "Network error" });
  }
}
