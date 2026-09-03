import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { createSkill, listSkills } from "@/lib/db";
import { parseSkillMd, toSkillImport } from "@/lib/skill-md";
import { audit } from "@/lib/audit";

/** Bounds on an untrusted upload — generous next to a real skill, still finite. */
const MAX_FILES = 50;
const MAX_FILE_CHARS = 200_000;

interface ImportFile {
  /** Original path, e.g. `skills/pdf-review/SKILL.md`; names the skill if the
   *  frontmatter doesn't. */
  path?: string;
  content?: string;
}

interface ImportResult {
  path: string;
  ok: boolean;
  id?: string;
  name?: string;
  error?: string;
  /** Portable spec fields present in the file that Liberde can't store. */
  ignoredFields?: string[];
}

/**
 * Import one or more Agent Skills (SKILL.md) files — https://agentskills.io
 *
 * Partial success is the normal case when a user drops a whole skills folder in,
 * so every file gets its own result rather than one bad file failing the batch.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  let body: { files?: ImportFile[]; content?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const files: ImportFile[] = Array.isArray(body.files)
    ? body.files
    : body.content
      ? [{ path: body.path, content: body.content }]
      : [];

  if (!files.length) {
    return Response.json(
      { error: "Provide `content` (one SKILL.md) or `files` (several)." },
      { status: 400 }
    );
  }
  if (files.length > MAX_FILES) {
    return Response.json(
      { error: `Too many files (max ${MAX_FILES}).` },
      { status: 413 }
    );
  }

  // Existing names are checked case-insensitively, matching POST /api/skills.
  // Tracked in a local set so two files in the SAME batch can't both claim a
  // name — a DB re-read per file would still race within the batch.
  const taken = new Set(
    (await listSkills(userId)).map((s) => s.name.toLowerCase())
  );

  const results: ImportResult[] = [];
  for (const [i, file] of files.entries()) {
    const path = file.path?.trim() || `file ${i + 1}`;
    const content = typeof file.content === "string" ? file.content : "";

    if (!content.trim()) {
      results.push({ path, ok: false, error: "File is empty" });
      continue;
    }
    if (content.length > MAX_FILE_CHARS) {
      results.push({ path, ok: false, error: "File is too large" });
      continue;
    }

    const imported = toSkillImport(parseSkillMd(content), file.path ?? "");
    if (!imported.name) {
      results.push({
        path,
        ok: false,
        error: "No skill name — add `name:` to the frontmatter or supply a path",
      });
      continue;
    }
    if (!imported.instructions) {
      results.push({ path, ok: false, error: "No instructions below the frontmatter" });
      continue;
    }
    if (!imported.description) {
      results.push({
        path,
        ok: false,
        error: "No description — add `description:` to the frontmatter",
      });
      continue;
    }
    if (taken.has(imported.name.toLowerCase())) {
      results.push({
        path,
        ok: false,
        name: imported.name,
        error: `A skill named "${imported.name}" already exists`,
      });
      continue;
    }

    const skill = await createSkill(
      {
        name: imported.name,
        description: imported.description,
        instructions: imported.instructions,
      },
      userId
    );
    taken.add(imported.name.toLowerCase());
    // Imported skills become system-prompt text the model follows, so where
    // one came from is a security-relevant fact worth keeping.
    await audit({
      action: "skill.imported",
      userId,
      targetType: "skill",
      targetId: skill.id,
      detail: { name: skill.name, path, bytes: content.length },
    });
    results.push({
      path,
      ok: true,
      id: skill.id,
      name: skill.name,
      ...(imported.ignoredFields.length ? { ignoredFields: imported.ignoredFields } : {}),
    });
  }

  return Response.json({
    imported: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
