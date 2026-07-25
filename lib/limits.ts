// Request-size guards. Prevent a single huge request (giant base64 attachment
// array, multi-MB content) from OOMing the serverless function or bloating the
// DB. Values are generous — real usage is far smaller — but bounded.

export const MAX_BODY_BYTES = 30 * 1024 * 1024; // 30 MB total request body
export const MAX_ATTACHMENTS = 10; // per message
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024; // ~12 MB per attachment (base64 image/PDF)
export const MAX_CONTENT_CHARS = 200_000; // a single user message's text

/** Reject an oversized request early (by Content-Length) before buffering it. */
export function bodyTooLarge(req: Request): Response | null {
  const len = Number(req.headers.get("content-length") || 0);
  if (len && len > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Request too large. Reduce attachment size or message length." },
      { status: 413 }
    );
  }
  return null;
}

/** Validate an attachments array; returns an error Response or null. */
export function attachmentsProblem(atts: unknown): Response | null {
  if (atts == null) return null;
  if (!Array.isArray(atts)) {
    return Response.json({ error: "Invalid attachments" }, { status: 400 });
  }
  if (atts.length > MAX_ATTACHMENTS) {
    return Response.json(
      { error: `Too many attachments (max ${MAX_ATTACHMENTS}).` },
      { status: 413 }
    );
  }
  for (const a of atts as { dataUrl?: string; text?: string }[]) {
    const size = (a?.dataUrl?.length ?? 0) + (a?.text?.length ?? 0);
    if (size > MAX_ATTACHMENT_BYTES) {
      return Response.json({ error: "An attachment is too large." }, { status: 413 });
    }
  }
  return null;
}
