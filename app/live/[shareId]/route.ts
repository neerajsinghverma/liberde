import { NextRequest } from "next/server";
import { getArtifactByShareId, getDeckTemplate } from "@/lib/db";
import { readDeckAttr } from "@/lib/deck-runtime";
import { buildSrcDoc } from "@/lib/artifact-srcdoc";
import type { ArtifactType } from "@/lib/artifact-shared";

export const runtime = "nodejs";

/**
 * One-click "deploy": serves a published artifact as a standalone hosted page
 * (raw full-screen HTML at a public URL), distinct from the /share snapshot
 * which wraps it in Liberde chrome.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  const art = await getArtifactByShareId(shareId);
  if (!art || !art.resolved) {
    return new Response("Not found or not published.", { status: 404 });
  }
  // A deck built on someone's own template has to carry that brand here too,
  // or a published link renders in the default theme and looks like a
  // different deck. Looked up by the id the markup records; a deleted template
  // degrades to the built-in themes.
  const templateId =
    art.type === "deck" ? readDeckAttr(art.resolved.content, "data-template") : null;
  const template = templateId ? await getDeckTemplate(templateId) : null;

  // A published deck reports per-card dwell back to us so the owner can see
  // which cards held attention. Only on this hosted path: the in-app preview
  // and the downloaded file measure nothing.
  const html = buildSrcDoc(art.type as ArtifactType, art.resolved.content, {
    beacon: art.type === "deck" ? `/api/deck-views/${encodeURIComponent(shareId)}` : undefined,
    template: template ?? null,
  });
  if (html == null) {
    return new Response("This artifact type can't be served as a live page.", { status: 400 });
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      // The artifact is user/model-authored HTML served on our own origin. The
      // CSP `sandbox` directive (no allow-same-origin) forces the browser to
      // render it in an opaque origin, so its scripts can't call our
      // authenticated /api/* endpoints with the viewer's session cookie — this
      // is the same protection the in-app iframe gets via its sandbox attr.
      "Content-Security-Policy":
        "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
