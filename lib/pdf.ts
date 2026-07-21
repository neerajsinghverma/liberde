// Server-side PDF text extraction so PDF attachments work with ANY provider,
// not just OpenRouter's file-parser plugin. Uses pdf-parse v2 (pdf.js based).

import { PDFParse } from "pdf-parse";

export async function extractPdfText(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1] ?? "";
  const buffer = Buffer.from(base64, "base64");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text ?? "").replace(/\s+\n/g, "\n").trim();
    return text.slice(0, 60_000) || "(no extractable text in this PDF)";
  } finally {
    await parser.destroy().catch(() => {});
  }
}
