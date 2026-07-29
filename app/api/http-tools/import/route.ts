import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized, authForced } from "@/lib/auth";
import { parseOpenApi } from "@/lib/openapi-import";
import { guardedFetch } from "@/lib/ssrf";

export const runtime = "nodejs";

/**
 * Parse an OpenAPI 3.x spec (from a URL or pasted JSON) into candidate tools.
 * The client then lets the user pick a subset + supply the auth secret, and
 * POSTs the chosen tools to /api/http-tools (source:"openapi").
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));

  let specText: string | null = (body.spec as string) ?? null;
  const specUrl = (body.specUrl as string)?.trim();

  if (!specText && specUrl) {
    let url: URL;
    try {
      url = new URL(specUrl);
    } catch {
      return Response.json({ error: "Invalid spec URL." }, { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return Response.json({ error: "Spec URL must be http/https." }, { status: 400 });
    }
    try {
      // SSRF: the spec URL is user-controllable — guardedFetch re-checks the
      // host on every redirect hop (a public spec URL can't 302 into internal
      // space). Off (guard:false) only on a self-host install.
      const res = await guardedFetch(
        url,
        { signal: AbortSignal.timeout(15_000) },
        { guard: authForced() }
      );
      if (!res.ok) return Response.json({ error: `Fetch failed (HTTP ${res.status}).` }, { status: 400 });
      specText = await res.text();
    } catch (e) {
      return Response.json(
        { error: `Could not fetch spec: ${e instanceof Error ? e.message : e}` },
        { status: 400 }
      );
    }
  }
  if (!specText) return Response.json({ error: "Provide a spec URL or paste the spec." }, { status: 400 });

  let doc: unknown;
  try {
    doc = JSON.parse(specText);
  } catch {
    return Response.json(
      { error: "Spec must be JSON (YAML isn't supported yet — export/convert to JSON)." },
      { status: 400 }
    );
  }
  try {
    const parsed = parseOpenApi(doc);
    return Response.json(parsed);
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
