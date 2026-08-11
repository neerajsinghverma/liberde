// Server-side DOCX text extraction. A .docx is a zip, so reading it as text
// (which is what the composer does for anything that isn't an image or PDF)
// yields binary garbage — it has to be parsed server-side like a PDF.
//
// Uses mammoth's markdown conversion rather than its plain-text mode: headings,
// lists and tables survive, which matters a lot for the documents people
// actually paste in (resumes, SOWs, plans) and costs roughly the same tokens.

import mammoth from "mammoth";
import { ensureAttachmentText } from "@/lib/attachment-text";
import { DOCX_MIME, DOCX_NO_TEXT, type Attachment, type Message } from "@/lib/types";

/**
 * Embedded images come back as inline base64 data URIs, which is catastrophic
 * for token cost — one real document went from 1.5k to 138k characters, almost
 * all of it base64. Drop the image markup and keep the prose.
 */
function stripInlineImages(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * mammoth implements markdown conversion but omits it from its .d.ts, so it has
 * to be reached through a cast. Guarded at runtime below in case a future
 * version actually drops it — plain text beats throwing.
 */
type MarkdownCapableMammoth = {
  convertToMarkdown?: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

export async function extractDocxText(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1] ?? "";
  const buffer = Buffer.from(base64, "base64");

  const toMarkdown = (mammoth as unknown as MarkdownCapableMammoth).convertToMarkdown;
  const raw = toMarkdown
    ? stripInlineImages((await toMarkdown({ buffer })).value ?? "")
    : (await mammoth.extractRawText({ buffer })).value ?? "";

  const text = raw.trim();
  if (!text) return DOCX_NO_TEXT;
  return text.slice(0, 60_000);
}

/**
 * Fill in `text` for every DOCX attachment in the history that lacks it.
 *
 * Returns true when at least one DOCX still has no usable text. Unlike PDFs
 * there's no provider-side parser to fall back to, so callers use this only to
 * tell the model the file couldn't be read rather than dropping it silently.
 */
export function ensureDocxText(
  messages: Message[],
  persist: (id: string, attachments: Attachment[]) => void | Promise<void>
): Promise<boolean> {
  return ensureAttachmentText(
    messages,
    persist,
    DOCX_MIME,
    extractDocxText,
    DOCX_NO_TEXT
  );
}
