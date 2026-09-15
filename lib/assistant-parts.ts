// Parsing the interactive blocks an assistant reply can carry: clarifying
// question cards (<liberdeAsk>) and the Present-mode deck outline
// (<liberdeOutline>).
//
// This is pure string work and it lives outside ChatView for one reason: it is
// the code most likely to be wrong, because it runs on whatever a model
// actually emitted rather than on what the prompt asked for. Models drop the
// wrapper tags, truncate mid-object, and stop mid-array. Every one of those
// has shipped a visible bug at least once, and none of it was testable while
// it sat inside a 3,500-line client component.
//
// The one invariant: a machine payload must NEVER reach the markdown renderer.
// It arrives as a bracketed line full of braces, which the maths normaliser
// reads as display LaTeX, so a leak does not look like JSON on screen — it
// looks like a page of run-together italic serif.

/** One card in a Present-mode outline, before the deck is built. */
export interface DeckOutlineCard {
  title: string;
  layout?: string;
  summary?: string;
}

/** The generation settings the outline carries; mirrors Gamma's setup screen. */
export interface DeckOutlineSettings {
  format: string;
  cards: number;
  text: string;
  images: string;
  size: string;
  theme: string;
  density?: string;
  tone?: string;
  audience?: string;
  language?: string;
}

export interface DeckOutline {
  title: string;
  settings: DeckOutlineSettings;
  cards: DeckOutlineCard[];
}

export const DEFAULT_OUTLINE_SETTINGS: DeckOutlineSettings = {
  format: "presentation",
  cards: 10,
  text: "medium",
  images: "themed",
  size: "fluid",
  theme: "slate",
  density: "medium",
  language: "en",
};

export interface AskQuestion {
  q: string;
  options?: string[];
  multi?: boolean;
}

export type AskPart =
  | { type: "md"; value: string }
  | { type: "ask"; questions: AskQuestion[] }
  | { type: "outline"; outline: DeckOutline };

/** Lenient parse of a <liberdeOutline> payload; same salvage rules as asks. */
export function parseOutlinePayload(raw: string): DeckOutline | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const coerce = (parsed: unknown): DeckOutline | null => {
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Partial<DeckOutline> & { cards?: unknown };
    const rawCards = Array.isArray(o.cards) ? o.cards : null;
    if (!rawCards || !rawCards.length) return null;
    const cards = rawCards
      .map((c): DeckOutlineCard | null =>
        typeof c === "string"
          ? { title: c }
          : c && typeof c === "object" && typeof (c as DeckOutlineCard).title === "string"
            ? {
                title: (c as DeckOutlineCard).title,
                layout: (c as DeckOutlineCard).layout,
                summary: (c as DeckOutlineCard).summary,
              }
            : null
      )
      .filter((c): c is DeckOutlineCard => Boolean(c));
    if (!cards.length) return null;
    return {
      title: typeof o.title === "string" ? o.title : "Untitled deck",
      settings: { ...DEFAULT_OUTLINE_SETTINGS, ...(o.settings || {}) },
      cards,
    };
  };
  try {
    const result = coerce(JSON.parse(s));
    if (result) return result;
  } catch {
    /* fall through to extraction */
  }
  const embedded = s.match(/\{[\s\S]*\}/)?.[0];
  if (embedded) {
    try {
      return coerce(JSON.parse(embedded));
    } catch {
      /* truly malformed */
    }
  }
  return null;
}

/** Parse an ask payload leniently — models emit arrays, bare objects,
 *  {questions:[...]} wrappers, and code-fenced JSON. */
export function parseAskPayload(raw: string): AskQuestion[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const coerce = (parsed: unknown): AskQuestion[] | null => {
    const qs = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { questions?: unknown[] })?.questions)
        ? (parsed as { questions: unknown[] }).questions
        : parsed && typeof parsed === "object" && typeof (parsed as AskQuestion).q === "string"
          ? [parsed]
          : null;
    if (!qs) return null;
    const clean = qs.filter(
      (q): q is AskQuestion => Boolean(q) && typeof (q as AskQuestion).q === "string"
    );
    return clean.length ? clean : null;
  };
  try {
    const result = coerce(JSON.parse(s));
    if (result) return result;
  } catch {
    /* fall through to extraction */
  }
  // Salvage: first JSON array or object embedded in surrounding prose.
  const embedded = s.match(/\[[\s\S]*\]/)?.[0] ?? s.match(/\{[\s\S]*\}/)?.[0];
  if (embedded) {
    try {
      return coerce(JSON.parse(embedded));
    } catch {
      /* truly malformed */
    }
  }
  return null;
}

/**
 * Split assistant text into markdown and the two interactive blocks: question
 * cards (<liberdeAsk>) and the Present-mode deck outline (<liberdeOutline>).
 * Both are hidden while still streaming so a half-written JSON payload never
 * flashes up as raw text.
 */
export function splitAsk(text: string): AskPart[] {
  const parts: AskPart[] = [];
  const re = /<liberde(Ask|Outline)>([\s\S]*?)<\/liberde\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: "md", value: text.slice(last, m.index) });
    const payload = m[2];
    if (m[1] === "Outline") {
      const outline = parseOutlinePayload(payload);
      if (outline) {
        parts.push({ type: "outline", outline });
      } else {
        // Unsalvageable: show the card titles as a plain list rather than JSON.
        const titles = [...payload.matchAll(/"title"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
        if (titles.length) {
          parts.push({ type: "md", value: titles.map((t, i) => `${i + 1}. ${t}`).join("\n") });
        }
      }
      last = re.lastIndex;
      continue;
    }
    const qs = parseAskPayload(payload);
    if (qs) {
      parts.push({ type: "ask", questions: qs });
    } else {
      // Unsalvageable payload: show the questions' text as plain markdown
      // rather than raw tags/JSON.
      const qTexts = [...payload.matchAll(/"q"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
      if (qTexts.length) {
        parts.push({ type: "md", value: qTexts.map((q) => `**${q}**`).join("\n\n") });
      }
    }
    last = re.lastIndex;
  }
  let rest = text.slice(last);
  // Hide an unterminated block still streaming in.
  rest = rest.replace(/<liberde(?:Ask|Outline)\b[\s\S]*$/, "");

  // Weaker models emit the outline payload with the wrapper tags missing, and
  // sometimes stop mid-object. Untagged JSON is still clearly an outline —
  // nothing else in a reply is an object carrying both "title" and "cards" —
  // so parse it rather than printing raw JSON at the user. Observed 2026-09-15
  // with mistralai/mistral-nemo.
  if (rest && /"cards"\s*:/.test(rest) && /"title"\s*:/.test(rest)) {
    const start = rest.search(/\{\s*"(?:title|settings|cards)"/);
    if (start >= 0) {
      const bare = parseOutlinePayload(rest.slice(start));
      const before = rest.slice(0, start);
      if (bare) {
        if (before.trim()) parts.push({ type: "md", value: before });
        parts.push({ type: "outline", outline: bare });
        rest = "";
      } else {
        // Truncated beyond salvage: drop the fragment instead of showing it.
        rest = before;
      }
    }
  }
  if (rest) parts.push({ type: "md", value: rest });
  if (parts.length) return parts;

  // Nothing rendered, which means the whole message was a machine block we
  // could not parse — an unterminated <liberdeAsk>, or a payload the model
  // mangled. This used to strip the tags and hand the rest to the markdown
  // renderer, so the reply arrived as a page of JSON typeset as LaTeX (the
  // bare-bracket display rule in lib/math.ts matched it exactly).
  //
  // So: salvage, in descending order of usefulness, and never print a payload.
  const salvaged = parseAskPayload(text.replace(/[\s\S]*?<liberdeAsk>?/, ""));
  if (salvaged) return [{ type: "ask", questions: salvaged }];
  const questions = [...text.matchAll(/"q"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (questions.length) {
    return [{ type: "md", value: questions.map((q) => `**${q}**`).join("\n\n") }];
  }
  return [
    {
      type: "md",
      value: text
        .replace(/<\/?liberde(?:Ask|Outline)>/g, "")
        // Any JSON object or array tail, whatever key it starts with.
        .replace(/\[?\s*\{\s*"[\s\S]*$/, "")
        .trim(),
    },
  ];
}

