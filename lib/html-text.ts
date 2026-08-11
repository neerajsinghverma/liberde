// Minimal HTML → readable-text conversion, and the MIME/MHTML unwrapping that
// has to happen first for "web archive saved as .doc" files.
//
// Not a general-purpose HTML parser: the goal is prose a model can read, so block
// elements become line breaks, list items get markers, table cells stay on one
// row, and everything else is dropped.

/** Entities worth resolving; the numeric forms cover the rest. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  trade: "™",
  copy: "©",
  reg: "®",
  deg: "°",
  eacute: "é",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name: string) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit ?? m;
    });
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function htmlToText(html: string): string {
  let s = html;

  // Drop anything whose contents aren't prose.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Word's HTML export wraps deleted revisions in these.
  s = s.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, "");

  // Structure worth keeping, as text.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|tr|blockquote|section|article)>/gi, "\n\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(td|th)>/gi, "\t");
  s = s.replace(/<\/?(table|thead|tbody|ul|ol)\b[^>]*>/gi, "\n");

  // Everything else goes.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function decodeQuotedPrintable(body: string, charset: string): string {
  // Soft line breaks first, then the =XX escapes, which are bytes — so they have
  // to be assembled as bytes and decoded with the declared charset, not per-char.
  const unfolded = body.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    const c = unfolded[i];
    if (c === "=" && /^[0-9a-f]{2}$/i.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0) & 0xff);
    }
  }
  return decodeBytes(Buffer.from(bytes), charset);
}

function decodeBytes(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/**
 * True for a MIME document — an MHTML "web archive", which is what you get from
 * "Save as Web Page" and from many .doc files that were never Word binaries.
 */
export function looksLikeMime(head: string): boolean {
  return (
    /^(from|date|message-id|mime-version|content-type|subject):/im.test(head) &&
    /content-type:/i.test(head)
  );
}

/**
 * Pull readable text out of an MHTML/MIME document: find the richest text part,
 * decode its transfer encoding and charset, then convert to text.
 */
export function mhtmlToText(raw: Buffer): string {
  const asLatin = raw.toString("latin1");
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(asLatin)?.[1];

  const parts = boundary
    ? asLatin.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?\\r?\\n?`))
    : [asLatin];

  const candidates: { html: boolean; text: string }[] = [];
  for (const part of parts) {
    const split = /\r?\n\r?\n/.exec(part);
    if (!split) continue;
    const headers = part.slice(0, split.index);
    const body = part.slice(split.index + split[0].length);
    const ctype = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.toLowerCase() ?? "";
    if (!ctype.startsWith("text/")) continue;

    const charset =
      /charset="?([^";\r\n]+)"?/i.exec(headers)?.[1]?.toLowerCase() ?? "utf-8";
    const encoding =
      /content-transfer-encoding:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.toLowerCase().trim() ??
      "";

    let decoded: string;
    if (encoding === "quoted-printable") {
      decoded = decodeQuotedPrintable(body, charset);
    } else if (encoding === "base64") {
      decoded = decodeBytes(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
    } else {
      decoded = decodeBytes(Buffer.from(body, "latin1"), charset);
    }

    const isHtml = ctype.includes("html");
    candidates.push({ html: isHtml, text: isHtml ? htmlToText(decoded) : decoded.trim() });
  }

  // Prefer the HTML part — in a Word web archive it holds the real formatting,
  // while the text/plain alternative is often a degraded copy.
  const best =
    candidates.filter((c) => c.html).sort((a, b) => b.text.length - a.text.length)[0] ??
    candidates.sort((a, b) => b.text.length - a.text.length)[0];

  return best?.text ?? "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
