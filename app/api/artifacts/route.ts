import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { listOwnedArtifacts, listSharedArtifactCards } from "@/lib/db";

/**
 * The artifacts gallery: everything the caller made, plus everything shared
 * with them, as browsable cards.
 *
 * Artifacts were only reachable through the conversation that produced them,
 * which is fine on the day you make one and useless a fortnight later when you
 * remember the deck but not the chat. This is the index.
 */

/** Filtering happens here rather than in SQL: the page size is small, and one
 *  query that both scopes can share is simpler than two parameterised ones. */
function matches(
  a: { title: string; preview: string; conversation_title: string },
  needle: string
): boolean {
  if (!needle) return true;
  const hay = (a.title + " " + a.conversation_title + " " + a.preview).toLowerCase();
  return hay.includes(needle);
}

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const scope = sp.get("scope") ?? "all";
  const needle = (sp.get("q") ?? "").trim().toLowerCase();

  const [mine, shared] = await Promise.all([
    scope === "shared" ? Promise.resolve([]) : listOwnedArtifacts(userId),
    scope === "mine" ? Promise.resolve([]) : listSharedArtifactCards(userId),
  ]);

  // Newest first across both scopes, so "all" reads as one timeline rather
  // than as owned-then-shared.
  const artifacts = [...mine, ...shared]
    .filter((a) => matches(a, needle))
    .sort((x, y) => y.updated_at - x.updated_at);

  return Response.json({
    artifacts,
    counts: { mine: mine.length, shared: shared.length },
  });
}
