// Server-side PDF text extraction so PDF attachments work with ANY provider,
// not just OpenRouter's file-parser plugin. Uses pdf-parse v2 (pdf.js based).
//
// We extract locally for every provider rather than delegating to a
// provider-side parser: one code path for all models, no per-page cost, and no
// dependence on which engine the provider happened to pick. OpenRouter's free
// `cloudflare-ai` engine, in particular, returns blank for PDFs pdf.js reads
// fine (e.g. LinkedIn profile exports) — and a blank result is indistinguishable
// from a real one by the time the model sees it.

// MUST come first — installs the DOM globals pdf.js reads at its module scope.
// See lib/pdf-dom-polyfill.ts for why this can't be inlined here.
import "@/lib/pdf-dom-polyfill";

import { PDFParse } from "pdf-parse";
import { ensureAttachmentText } from "@/lib/attachment-text";
import { PDF_NO_TEXT, type Attachment, type Message } from "@/lib/types";

export async function extractPdfText(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1] ?? "";
  const buffer = Buffer.from(base64, "base64");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    // Emptiness must be measured per page, not on result.text: the joined
    // string carries "-- 1 of 3 --" page markers, so a PDF with no text layer
    // at all still comes back non-empty and looks like a clean extraction.
    const content = result.pages
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!content) return PDF_NO_TEXT;
    const text = (result.text ?? "").replace(/\s+\n/g, "\n").trim();
    return text.slice(0, 60_000);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Fill in `text` for every PDF attachment in the history that lacks it.
 *
 * Returns true when at least one PDF still has no usable text, so callers can
 * decide whether to also hand the raw file to a provider-side parser.
 */
export function ensurePdfText(
  messages: Message[],
  persist: (id: string, attachments: Attachment[]) => void | Promise<void>
): Promise<boolean> {
  return ensureAttachmentText(
    messages,
    persist,
    "application/pdf",
    extractPdfText,
    PDF_NO_TEXT
  );
}
