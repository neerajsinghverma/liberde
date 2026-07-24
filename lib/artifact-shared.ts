// Artifact protocol shared by server (parsing/persistence) and client (rendering).
// Modeled on Claude.ai's artifact system: inline tags the model emits, with
// create / update (str-replace) / rewrite commands and per-identifier versioning.

export type ArtifactType =
  | "html"
  | "svg"
  | "react"
  | "mermaid"
  | "markdown"
  | "code"
  | "slides";

export const ARTIFACT_TYPES: ArtifactType[] = [
  "html",
  "svg",
  "react",
  "mermaid",
  "markdown",
  "code",
  "slides",
];

export interface ArtifactRecord {
  id: string;
  conversation_id: string;
  identifier: string;
  type: ArtifactType;
  language: string | null;
  title: string;
  share_id: string | null;
  share_mode: "latest" | "pinned" | null;
  pinned_version: number | null;
  created_at: number;
  updated_at: number;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  message_id: string | null;
  created_at: number;
}

export interface ParsedBlock {
  identifier: string;
  command: "create" | "update" | "rewrite";
  type: ArtifactType | null;
  language: string | null;
  title: string | null;
  /** Full content for create/rewrite. */
  content: string;
  /** str-replace pairs for update. */
  replacements: { oldStr: string; newStr: string }[];
  /** Raw span in the source text, for display splitting. */
  start: number;
  end: number;
}

const OPEN_TAG = /<liberdeArtifact\b([^>]*)>/g;
const CLOSE_TAG = "</liberdeArtifact>";
const ATTR = /([\w-]+)="([^"]*)"/g;
const REPLACEMENT =
  /<liberdeOld>([\s\S]*?)<\/liberdeOld>\s*<liberdeNew>([\s\S]*?)<\/liberdeNew>/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) attrs[m[1]] = m[2];
  return attrs;
}

function stripLeadingFence(content: string): string {
  // Models often wrap artifact content in a ``` fence despite instructions.
  const trimmed = content.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const fenced = trimmed.match(/^```[\w+-]*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1] : trimmed;
}

/** Parse all complete artifact blocks out of an assistant message. */
export function parseArtifactBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  OPEN_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN_TAG.exec(text))) {
    const attrs = parseAttrs(m[1]);
    const bodyStart = m.index + m[0].length;
    const closeIdx = text.indexOf(CLOSE_TAG, bodyStart);
    if (closeIdx === -1) break; // unterminated (still streaming) — not a complete block
    const body = text.slice(bodyStart, closeIdx);
    const end = closeIdx + CLOSE_TAG.length;
    OPEN_TAG.lastIndex = end;

    const identifier = (attrs.identifier || "").trim();
    if (!identifier) continue;
    const command = (["create", "update", "rewrite"].includes(attrs.command)
      ? attrs.command
      : "create") as ParsedBlock["command"];

    const replacements: { oldStr: string; newStr: string }[] = [];
    if (command === "update") {
      for (const r of body.matchAll(REPLACEMENT)) {
        replacements.push({ oldStr: r[1], newStr: r[2] });
      }
    }

    blocks.push({
      identifier,
      command,
      type: ARTIFACT_TYPES.includes(attrs.type as ArtifactType)
        ? (attrs.type as ArtifactType)
        : null,
      language: attrs.language || null,
      title: attrs.title || null,
      content: command === "update" ? "" : stripLeadingFence(body),
      replacements,
      start: m.index,
      end,
    });
  }
  return blocks;
}

/**
 * Apply update replacements the way Claude does: each oldStr must appear
 * EXACTLY once. Uses literal splicing (never String.replace) so `$&`-style
 * substitution patterns in newStr can't corrupt the artifact, and skips
 * ambiguous (non-unique) matches instead of guessing.
 */
export function applyReplacements(
  content: string,
  replacements: { oldStr: string; newStr: string }[]
): { content: string; applied: number } {
  let out = content;
  let applied = 0;
  for (const { oldStr, newStr } of replacements) {
    if (!oldStr) continue;
    const first = out.indexOf(oldStr);
    if (first === -1) continue; // no match
    if (out.indexOf(oldStr, first + 1) !== -1) continue; // ambiguous — skip
    out = out.slice(0, first) + newStr + out.slice(first + oldStr.length);
    applied++;
  }
  return { content: out, applied };
}

export interface ContentSegment {
  kind: "text" | "artifact" | "streaming-artifact" | "run" | "streaming-run";
  text?: string;
  block?: ParsedBlock;
  /** For streaming-artifact: attrs + partial content of the unterminated block. */
  partial?: { identifier: string; title: string | null; type: string | null; content: string };
  /** For run / streaming-run: the JavaScript source. */
  runCode?: string;
}

const RUN_OPEN = "<liberdeRun>";
const RUN_CLOSE = "</liberdeRun>";

/** Split a text chunk further into text / run / streaming-run segments. */
function splitRuns(text: string): ContentSegment[] {
  const out: ContentSegment[] = [];
  let cursor = 0;
  for (;;) {
    const open = text.indexOf(RUN_OPEN, cursor);
    if (open === -1) break;
    if (open > cursor) out.push({ kind: "text", text: text.slice(cursor, open) });
    const close = text.indexOf(RUN_CLOSE, open);
    if (close === -1) {
      out.push({ kind: "streaming-run", runCode: text.slice(open + RUN_OPEN.length) });
      return out;
    }
    out.push({ kind: "run", runCode: text.slice(open + RUN_OPEN.length, close).trim() });
    cursor = close + RUN_CLOSE.length;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

/**
 * Split message content into text and artifact segments for display.
 * Handles an unterminated trailing block (mid-stream) as "streaming-artifact".
 */
export function splitContentSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const blocks = parseArtifactBlocks(text);
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) {
      segments.push(...splitRuns(text.slice(cursor, block.start)));
    }
    segments.push({ kind: "artifact", block });
    cursor = block.end;
  }
  const rest = text.slice(cursor);
  // Detect an unterminated artifact tag at the tail (streaming in progress).
  const openMatch = /<liberdeArtifact\b([^>]*)>?/.exec(rest);
  if (openMatch && !rest.includes(CLOSE_TAG)) {
    const before = rest.slice(0, openMatch.index);
    if (before) segments.push(...splitRuns(before));
    const tagComplete = rest.slice(openMatch.index).includes(">");
    const attrs = tagComplete ? parseAttrs(openMatch[1]) : {};
    const bodyStart = tagComplete
      ? rest.indexOf(">", openMatch.index) + 1
      : rest.length;
    segments.push({
      kind: "streaming-artifact",
      partial: {
        identifier: attrs.identifier || "",
        title: attrs.title || null,
        type: attrs.type || null,
        content: rest.slice(bodyStart),
      },
    });
  } else if (rest) {
    segments.push(...splitRuns(rest));
  }
  return segments;
}

/** Instructions appended to the system prompt so any OpenRouter model can emit artifacts. */
export const ARTIFACTS_SYSTEM_PROMPT = `# Artifacts

You can create "artifacts" — substantial, self-contained content shown in a dedicated panel beside the conversation, which the user can preview, iterate on, publish, and share.

Create an artifact when content is substantial (roughly >15 lines), self-contained, and something the user will edit, reuse, or take ownership of: web pages, components, documents, diagrams, scripts, long code. Do NOT use artifacts for short snippets, explanations, or answers woven into conversation — put those in the message itself.

## Format

**An artifact is created ONLY by writing the block below directly in your reply — there is no "create artifact" tool, and artifact_read does NOT make one.** Never announce "building it now", "here it is", or "let me create that" without the complete <liberdeArtifact> block in the SAME message. Do not call artifact_read before any artifact exists. When the user asks you to build something, your reply must contain the full block — write it immediately.

Wrap artifact content in tags (raw content inside, NO markdown code fence):

<liberdeArtifact identifier="kebab-case-id" command="create" type="TYPE" title="Short title" language="LANG-for-code-type">
...full raw content...
</liberdeArtifact>

Types:
- "html" — a complete standalone HTML page (inline CSS/JS; may load libraries from CDNs like cdnjs/jsdelivr/unpkg)
- "react" — a single React component. Must have a default export. May import from "react", "lucide-react", "recharts". Style with Tailwind utility classes (no arbitrary values). No required props.
- "slides" — a presentation. Emit one <section class="slide">…</section> per slide plus ONE <style> block for your design (typography, colors, layout — make it beautiful and consistent, like a keynote). Do NOT write navigation code, position slides, or hide/show them — the interface adds navigation, a counter, and PDF export automatically. Optionally end each section with speaker notes as <aside class="notes">1–3 sentences of what the presenter should say</aside> — hidden on the slide, shown in the player's notes panel, exported as PowerPoint presenter notes.
- "svg" — an SVG image (the <svg> element itself)
- "mermaid" — a Mermaid diagram definition
- "markdown" — a formatted document
- "code" — source code in any language (set language="python" etc.)

Pick the type from what the user wants to MAKE: presentation/deck/pitch → "slides"; website/landing page/game → "html"; interactive app/dashboard/calculator → "react" or "html"; report/essay/letter/plan → "markdown"; diagram/flowchart → "mermaid"; logo/illustration → "svg". Users can preview, present full-screen, publish to a link, and download every artifact.

## Updating an existing artifact

Reuse the SAME identifier. For small targeted changes (fewer than ~20 changed lines), emit an update command with one or more exact string replacements — each <liberdeOld> must match the current artifact content EXACTLY (including whitespace) and appear exactly once:

<liberdeArtifact identifier="same-id" command="update">
<liberdeOld>exact existing text</liberdeOld>
<liberdeNew>replacement text</liberdeNew>
</liberdeArtifact>

For major changes, rewrite the whole artifact:

<liberdeArtifact identifier="same-id" command="rewrite" type="TYPE" title="Title">
...complete new content...
</liberdeArtifact>

Each create/update/rewrite produces a new version; the user can step through versions and publish any of them. Briefly mention what you built or changed in normal prose outside the tags — never describe the artifact syntax itself to the user.

Verify your work: you can call the artifact_read tool to read back an artifact's current content (to confirm what you built or before editing it), and use the analysis tool (<liberdeRun>) to test any logic/algorithms an artifact relies on before finalizing. For html/react artifacts, if the preview reports a runtime error you will be asked to fix it — write careful, self-contained, working code the first time.`;
