// Agent Skills (SKILL.md) interop — https://agentskills.io
//
// The open standard is a folder holding a SKILL.md: YAML frontmatter between
// `---` markers, then a Markdown body. Six frontmatter fields are portable
// across tools — name, description, license, compatibility, metadata,
// allowed-tools — and everything else is a host-specific extension. Liberde
// models a skill as name + description + instructions, so import maps those
// three and reports fields it has nowhere to put; export writes the portable
// subset. That is enough to move skills between Liberde, Claude Code,
// claude.ai, VS Code, Codex and the rest of the ecosystem.
//
// The frontmatter reader is hand-rolled rather than pulling in a YAML library:
// skill frontmatter is a tiny, flat subset (scalars, block scalars, simple
// lists, a one-level metadata map), the file arrives from an untrusted upload,
// and a general YAML parser is a large attack surface for the payoff.

export type FrontmatterValue = string | string[] | Record<string, string>;

export interface ParsedSkillMd {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

const KEY_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/;
const indentOf = (line: string) => line.length - line.trimStart().length;

/** Strip YAML quoting from a scalar, honouring the two escape dialects. */
function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  // Unquoted scalars may carry a trailing comment.
  const hash = s.indexOf(" #");
  return (hash === -1 ? s : s.slice(0, hash)).trim();
}

/** Split a `[a, b]` flow sequence or an `a, b` / `a b` scalar into items. */
export function splitList(value: FrontmatterValue): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const s = value.trim().replace(/^\[|\]$/g, "");
  return s
    .split(/[,\s]+/)
    .map((t) => unquote(t))
    .filter(Boolean);
}

/**
 * Parse a SKILL.md document. A file with no frontmatter is not an error — the
 * whole text becomes the body, which is what a bare instructions file should do.
 */
export function parseSkillMd(text: string): ParsedSkillMd {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  // Frontmatter opens on the first non-blank line, and only there.
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (lines[start]?.trim() !== "---") {
    return { frontmatter: {}, body: normalized.trim() };
  }

  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      end = i;
      break;
    }
  }
  // An unterminated `---` block is malformed YAML; treating the file as a plain
  // body loses nothing and beats swallowing the whole document as frontmatter.
  if (end === -1) return { frontmatter: {}, body: normalized.trim() };

  const frontmatter: Record<string, FrontmatterValue> = {};
  const fm = lines.slice(start + 1, end);

  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (indentOf(line) > 0) continue; // continuation, consumed by its key below
    const m = KEY_LINE.exec(line);
    if (!m) continue;
    const key = m[1];
    const inline = m[2].trim();

    // Block scalar: `key: |`, `|-`, `>`, `>-`.
    if (/^[|>][+-]?$/.test(inline)) {
      const folded = inline.startsWith(">");
      const block: string[] = [];
      let j = i + 1;
      for (; j < fm.length; j++) {
        if (fm[j].trim() === "") {
          block.push("");
          continue;
        }
        if (indentOf(fm[j]) === 0) break;
        block.push(fm[j].trimStart());
      }
      i = j - 1;
      while (block.length && block[block.length - 1] === "") block.pop();
      frontmatter[key] = folded
        ? block.join(" ").replace(/\s+/g, " ").trim()
        : block.join("\n");
      continue;
    }

    if (inline !== "") {
      frontmatter[key] = inline.startsWith("[") ? splitList(inline) : unquote(inline);
      continue;
    }

    // Empty value: a nested block sequence, a nested map, or genuinely empty.
    const items: string[] = [];
    const map: Record<string, string> = {};
    let j = i + 1;
    for (; j < fm.length; j++) {
      if (fm[j].trim() === "") continue;
      if (indentOf(fm[j]) === 0) break;
      const child = fm[j].trim();
      if (child.startsWith("- ")) items.push(unquote(child.slice(2)));
      else {
        const cm = KEY_LINE.exec(child);
        if (cm) map[cm[1]] = unquote(cm[2]);
      }
    }
    i = j - 1;
    if (items.length) frontmatter[key] = items;
    else if (Object.keys(map).length) frontmatter[key] = map;
    else frontmatter[key] = "";
  }

  return { frontmatter, body: lines.slice(end + 1).join("\n").trim() };
}

/** The first real paragraph of a Markdown body, skipping a leading heading. */
function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith("#") || t.startsWith("---")) continue;
    return t.replace(/\s+/g, " ");
  }
  return "";
}

/** Derive a skill name from a path like `skills/pdf-review/SKILL.md`. */
export function nameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? "";
  // The standard puts the name on the directory; a bare `foo.md` names itself.
  const base = /^skill\.md$/i.test(file)
    ? parts[parts.length - 2] ?? ""
    : file.replace(/\.md$/i, "");
  return base.trim();
}

export interface SkillImport {
  name: string;
  description: string;
  instructions: string;
  /** Portable spec fields Liberde has nowhere to store, surfaced to the user. */
  ignoredFields: string[];
}

/** Liberde's own limits, mirrored from app/api/skills/route.ts. */
const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;

/** Fields the spec defines as portable; anything else is a host extension. */
const SPEC_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

/**
 * Turn a parsed SKILL.md into the shape createSkill expects. Per the spec, a
 * missing `name` falls back to the directory name and a missing `description`
 * to the body's first paragraph, so a minimal file still imports cleanly.
 */
export function toSkillImport(parsed: ParsedSkillMd, path = ""): SkillImport {
  const fm = parsed.frontmatter;
  const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : "");

  const name = (str("name") || nameFromPath(path)).trim().slice(0, NAME_MAX);
  const description = (str("description") || firstParagraph(parsed.body))
    .trim()
    .slice(0, DESCRIPTION_MAX);

  const ignoredFields = Object.keys(fm).filter(
    (k) => SPEC_FIELDS.has(k) && k !== "name" && k !== "description" && fm[k] !== ""
  );

  return { name, description, instructions: parsed.body.trim(), ignoredFields };
}

/** Quote a scalar only when YAML would otherwise misread it. */
function yamlScalar(value: string): string {
  const needsQuote =
    value === "" ||
    /^[\s>|*&!%@`'"[\]{}#-]/.test(value) ||
    /: /.test(value) ||
    // ` #` opens a trailing comment in an unquoted scalar, so a description
    // like "step 1 # then step 2" would come back truncated.
    / #/.test(value) ||
    /[\t\n]/.test(value) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(value) ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    /\s$/.test(value);
  if (!needsQuote) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/**
 * Write a spec-compliant SKILL.md. Only the portable fields are emitted, so the
 * result loads unmodified in any Agent Skills host.
 */
export function serializeSkillMd(skill: {
  name: string;
  description: string;
  instructions: string;
}): string {
  const front = [
    "---",
    `name: ${yamlScalar(skill.name.trim())}`,
    `description: ${yamlScalar(skill.description.trim().replace(/\s+/g, " "))}`,
    "---",
  ].join("\n");
  return `${front}\n\n${skill.instructions.trim()}\n`;
}

/** A filesystem-safe directory name for a skill, as the standard expects. */
export function skillSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "skill"
  );
}
