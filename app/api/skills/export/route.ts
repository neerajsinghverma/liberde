import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getSkill, listSkills } from "@/lib/db";
import { serializeSkillMd, skillSlug } from "@/lib/skill-md";

/**
 * Export skills as Agent Skills (SKILL.md) documents — https://agentskills.io
 *
 * `?id=` returns one file as text/markdown, ready to save straight into a
 * `skills/<slug>/SKILL.md`. With no id, every skill comes back as a JSON
 * manifest of `{ path, content }` so the client can write the folder tree
 * itself — zipping server-side would mean a new dependency for no real gain.
 */
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const skill = await getSkill(id);
    // Ownership: a skill body is user-authored prose that may hold private
    // procedure detail, so never serve one across accounts.
    if (!skill || skill.user_id !== userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const slug = skillSlug(skill.name);
    return new Response(serializeSkillMd(skill), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-SKILL.md"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const skills = await listSkills(userId);
  return Response.json({
    count: skills.length,
    files: skills.map((s) => ({
      path: `skills/${skillSlug(s.name)}/SKILL.md`,
      content: serializeSkillMd(s),
    })),
  });
}
