// Legacy .doc extraction. The extension is a lie more often than not, so this
// sniffs the real format from magic bytes and dispatches, rather than trusting
// the name or the browser-reported mime type.
//
// Encountered in practice:
//   OLE2 compound binary  — a genuine Word 97-2003 file
//   MHTML / MIME          — "Save as Web Page"; very common for .doc downloads
//   bare HTML             — Word's filtered-HTML export
//   ZIP                   — a .docx that was renamed

import WordExtractor from "word-extractor";
import { ensureAttachmentText } from "@/lib/attachment-text";
import { htmlToText, looksLikeMime, mhtmlToText } from "@/lib/html-text";
import { DOC_MIME, DOC_NO_TEXT, type Attachment, type Message } from "@/lib/types";

const OLE2_MAGIC = "d0cf11e0a1b11ae1";

export async function extractDocText(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1] ?? "";
  const buffer = Buffer.from(base64, "base64");
  const head = buffer.subarray(0, 2048).toString("latin1");

  let text: string;

  if (buffer.subarray(0, 8).toString("hex") === OLE2_MAGIC) {
    const doc = await new WordExtractor().extract(buffer);
    // Footnotes carry real content in the documents people share; headers and
    // footers are usually page furniture, so they're left out.
    text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
      .filter((part) => part && part.trim())
      .join("\n\n");
  } else if (buffer.subarray(0, 2).toString("latin1") === "PK") {
    // A renamed .docx. Delegate rather than fail on a technicality.
    const { extractDocxText } = await import("@/lib/docx");
    return extractDocxText(dataUrl);
  } else if (looksLikeMime(head)) {
    text = mhtmlToText(buffer);
  } else if (/<html|<body|<\?xml|<w:worddocument/i.test(head)) {
    text = htmlToText(buffer.toString("utf8"));
  } else if (head.startsWith("{\\rtf")) {
    // RTF isn't supported; say so plainly instead of emitting control words.
    return DOC_NO_TEXT;
  } else {
    return DOC_NO_TEXT;
  }

  const cleaned = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return DOC_NO_TEXT;
  return cleaned.slice(0, 60_000);
}

/** Fill in `text` for every legacy .doc attachment in the history that lacks it. */
export function ensureDocText(
  messages: Message[],
  persist: (id: string, attachments: Attachment[]) => void | Promise<void>
): Promise<boolean> {
  return ensureAttachmentText(messages, persist, DOC_MIME, extractDocText, DOC_NO_TEXT);
}
