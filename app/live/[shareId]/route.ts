import { NextRequest } from "next/server";
import { getArtifactByShareId } from "@/lib/db";
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
  const html = buildSrcDoc(art.type as ArtifactType, art.resolved.content);
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
