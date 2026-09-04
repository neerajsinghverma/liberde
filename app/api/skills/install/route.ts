import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { listSkills } from "@/lib/db";
import { parseSkillMd, toSkillImport } from "@/lib/skill-md";
import { guardedFetch } from "@/lib/ssrf";
import { declaredTools, MAX_BYTES, notices, rawUrlFor } from "@/lib/skill-install";

/**
 * Fetch a SKILL.md from a URL and return it for review — without installing it.
 *
 * Installing is deliberately a second, explicit step. A skill is prose that
 * goes into the system prompt and that the model then follows, so pulling one
 * from a stranger's repository is closer to running their code than to opening
 * their document. The open standard makes 280,000-odd skills reachable, and the
 * same portability that makes them useful makes a malicious one portable too.
 * This endpoint therefore shows exactly what arrived; POST /api/skills/import
 * is what actually writes it.
 */

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const raw = rawUrlFor(String(body.url ?? ""));
  if (!raw) {
    return Response.json(
      { error: "Give an https URL to a SKILL.md file." },
      { status: 400 }
    );
  }

  let text: string;
  try {
    // guardedFetch blocks private addresses and strips credentials across
    // redirects: this URL comes from the user, so it must not be usable to
    // read anything on the server's own network.
    const res = await guardedFetch(raw, { redirect: "manual" });
    if (!res.ok) {
      return Response.json(
        { error: "Could not fetch that URL (" + res.status + ")." },
        { status: 400 }
      );
    }
    text = (await res.text()).slice(0, MAX_BYTES);
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message || e).slice(0, 160) },
      { status: 400 }
    );
  }

  const parsed = parseSkillMd(text);
  const imported = toSkillImport(parsed, new URL(raw).pathname);
  if (!imported.name || !imported.instructions) {
    return Response.json(
      { error: "That URL did not return a SKILL.md (no name or no instructions)." },
      { status: 400 }
    );
  }

  const clash = (await listSkills(userId)).some(
    (s) => s.name.toLowerCase() === imported.name.toLowerCase()
  );

  return Response.json({
    url: raw,
    name: imported.name,
    description: imported.description,
    instructions: imported.instructions,
    bytes: text.length,
    ignoredFields: imported.ignoredFields,
    nameTaken: clash,
    // Surfaced so a reviewer can see what the skill will be allowed to reach
    // before agreeing to it, rather than discovering it mid-conversation.
    declaredTools: declaredTools(parsed.frontmatter),
    // Not a verdict, just the lines worth a second look. A skill is prose, so
    // there is no sound way to decide automatically that it is safe — the
    // point is to put the risky-looking parts in front of a person.
    notices: notices(imported.instructions),
  });
}
