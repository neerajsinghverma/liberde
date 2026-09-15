import { NextRequest } from "next/server";
import { getArtifactByShareId, recordDeckView } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Per-card dwell beacons from a published deck.
 *
 * Unauthenticated on purpose: the whole point is measuring people who opened a
 * public link, and a published page runs at an opaque origin with no session to
 * authenticate with. So this accepts anonymous posts addressed by share id and
 * stores nothing that identifies anyone — no IP, no user agent, just a random
 * id the page invented for its own session so repeat cards are not counted as
 * separate viewers.
 *
 * Only decks that are actually published are accepted, and the payload is a
 * card number and a duration, both clamped. A flood of forged beacons can
 * inflate a view count; it cannot reach anything else.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  const art = await getArtifactByShareId(shareId);
  if (!art || art.type !== "deck") {
    // Deliberately 204 rather than 404: a beacon has nobody to tell, and a
    // distinguishable error would turn this into a share-id oracle.
    return new Response(null, { status: 204 });
  }
  try {
    const body = (await req.json()) as { view?: string; card?: number; ms?: number };
    const card = Number(body.card);
    const ms = Number(body.ms);
    const view = typeof body.view === "string" ? body.view : "";
    if (view && Number.isFinite(card) && Number.isFinite(ms) && ms > 250) {
      await recordDeckView(art.id, view, Math.max(0, Math.min(999, Math.floor(card))), Math.floor(ms));
    }
  } catch {
    /* a malformed beacon is not worth an error page nobody will read */
  }
  return new Response(null, { status: 204 });
}
