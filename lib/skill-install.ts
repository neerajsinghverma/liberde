// URL handling and review heuristics for installing a SKILL.md from the web.
// Kept out of the route file because a Next route module may only export
// handlers, and because these are the parts worth unit-testing.
/** Generous next to a real skill, still finite. */
export const MAX_BYTES = 200_000;

/** Rewrite the URLs people actually paste into ones that return raw Markdown. */
export function rawUrlFor(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  // github.com/owner/repo/blob/ref/path -> raw.githubusercontent.com/owner/repo/ref/path
  if (u.hostname === "github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const at = parts.indexOf("blob");
    if (at >= 2 && parts.length > at + 1) {
      const owner = parts[0];
      const repo = parts[1];
      const rest = parts.slice(at + 1).join("/");
      return "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + rest;
    }
  }
  return u.toString();
}


/** Tools the skill declares it wants, per the standard's allowed-tools field. */
export function declaredTools(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter["allowed-tools"];
  if (Array.isArray(raw)) return raw.map(String).slice(0, 40);
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 40);
  }
  return [];
}

/**
 * Lines worth a second look before installing.
 *
 * This is not a safety verdict and must not be presented as one. A skill is
 * natural-language instructions, so deciding automatically whether it is
 * benign is the unsolved problem, not a heuristic away. What this can do is
 * put the handful of patterns that have historically mattered — instructions
 * to ignore other instructions, to exfiltrate, or to act without asking — in
 * front of the person who is about to trust it.
 */
export function notices(instructions: string): { line: string; why: string }[] {
  const checks: { re: RegExp; why: string }[] = [
    {
      re: /ignore (all |any )?(previous|prior|above|other) (instructions|prompts|rules)/i,
      why: "tries to override instructions it was given",
    },
    {
      re: /(do not|don\u2019t|never) (tell|inform|mention to|show) the user/i,
      why: "asks to withhold something from you",
    },
    {
      re: /(send|post|upload|exfiltrate|forward)[^.\n]{0,40}(api[ _-]?key|token|secret|credential|password)/i,
      why: "mentions sending credentials somewhere",
    },
    {
      re: /(without asking|without confirmation|do not ask|skip (the )?confirmation)/i,
      why: "asks to act without confirming first",
    },
    {
      re: /https?:\/\/[^\n )]+/i,
      why: "contains a URL the skill may direct traffic to",
    },
  ];
  const out: { line: string; why: string }[] = [];
  for (const line of instructions.split(/\r?\n/)) {
    for (const c of checks) {
      if (c.re.test(line)) {
        out.push({ line: line.trim().slice(0, 200), why: c.why });
        break;
      }
    }
    if (out.length >= 12) break;
  }
  return out;
}
