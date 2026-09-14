// Making arbitrary bytes off the internet safe to store and stream.
//
// Tool output is not our text: a page can be a PDF, a zip, or UTF-16, and what
// comes back gets written straight into a Postgres TEXT column. Postgres cannot
// store U+0000 in TEXT at all, and a lone surrogate is not valid UTF-8 — either
// one makes the INSERT throw. That throw lands outside the tool's own error
// handling, so it killed the whole turn ("The model call failed. Please try
// again.") rather than the one tool step that produced the bytes.

// NUL and the other C0 controls that aren't whitespace. Built from a string so
// this file doesn't itself contain the invisible characters it strips.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");
const ANY_SURROGATE = /[\uD800-\uDFFF]/g;

/**
 * Strip what a TEXT column can't hold: NUL and friends, plus any unpaired
 * surrogate (truncating a string mid-pair makes one). Tabs, newlines and
 * carriage returns are kept — they are real content.
 */
export function scrubText(s: string): string {
  if (!s) return s;
  const clean = s.replace(CONTROL_CHARS, "");
  return clean.replace(ANY_SURROGATE, (ch, i: number, str: string) => {
    const code = ch.charCodeAt(0);
    if (code <= 0xdbff) {
      const next = str.charCodeAt(i + 1);
      return next >= 0xdc00 && next <= 0xdfff ? ch : "�";
    }
    const prev = str.charCodeAt(i - 1);
    return prev >= 0xd800 && prev <= 0xdbff ? ch : "�";
  });
}

/**
 * True when a byte run is binary rather than text. A NUL in the first few KB is
 * the heuristic grep and git use; it never fires on real prose.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 8192);
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true;
  return false;
}
