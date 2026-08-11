// Shared "fill in attachment.text once, then reuse it" loop, used by the PDF and
// DOCX extractors. Deliberately free of any dependency on the extractors or the
// DB layer, so importing it never drags pdf.js (or a native canvas addon) into a
// bundle that only needs DOCX.

import type { Attachment, Message } from "@/lib/types";

/**
 * Fill in `text` for every attachment of `mime` in the history that lacks it,
 * persisting the result so each file is parsed once per conversation.
 *
 * `persist` saves a message's attachments (pass `updateMessageAttachments`); it's
 * injected rather than imported both to keep this module free of the DB layer and
 * because the two editions differ — Neon's is async, SQLite's is sync.
 *
 * A thrown extraction is deliberately left as `text == null` rather than
 * persisted as an error string: a placeholder would satisfy the `text == null`
 * guard forever, so a transient failure — or one already fixed by a deploy —
 * could never be retried. Parsing is local and cheap, so retrying is the
 * cheaper mistake.
 *
 * Returns true when at least one matching attachment still has no usable text.
 */
export async function ensureAttachmentText(
  messages: Message[],
  persist: (id: string, attachments: Attachment[]) => void | Promise<void>,
  mime: string,
  extract: (dataUrl: string) => Promise<string>,
  /** Text that means "parsed fine, but there was nothing to read". */
  emptyMarker?: string
): Promise<boolean> {
  for (const msg of messages) {
    const attachments = msg.attachments;
    const pending = attachments?.filter(
      (a: Attachment) => a.mime === mime && a.dataUrl && a.text == null
    );
    if (!attachments || !pending?.length) continue;
    let extracted = false;
    for (const file of pending) {
      try {
        file.text = await extract(file.dataUrl!);
        extracted = true;
      } catch {
        // Leave text null so the next turn retries.
      }
    }
    if (extracted) await persist(msg.id, attachments);
  }

  return messages.some((msg) =>
    (msg.attachments ?? []).some(
      (a) =>
        a.mime === mime &&
        a.dataUrl &&
        (a.text == null || (emptyMarker != null && a.text === emptyMarker))
    )
  );
}
