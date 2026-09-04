import { getRequestUserId, unauthorized } from "@/lib/auth";
import { listProjectFiles, listProjects } from "@/lib/db";
import { embeddingConfig } from "@/lib/embeddings";
import { indexProject } from "@/lib/rag";

export const maxDuration = 800;

/**
 * Index every project's knowledge for semantic retrieval.
 *
 * Uploading a file indexes it, which covers everything added after an
 * embeddings endpoint is configured — but not the files already there. Without
 * this, turning the feature on appears to do nothing: the setting saves, and
 * every existing project keeps quietly using the lexical scorer until each of
 * its files is re-uploaded. That gap is invisible from the interface, which is
 * the worst kind.
 *
 * Files that already have vectors for the current model are skipped, so running
 * it twice is cheap and safe.
 */
export async function POST() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const cfg = await embeddingConfig(userId);
  if (!cfg) {
    return Response.json(
      { error: "No embeddings endpoint is configured." },
      { status: 400 }
    );
  }

  const projects = await listProjects(userId);
  let indexed = 0;
  let projectsTouched = 0;
  const failed: string[] = [];

  for (const p of projects) {
    try {
      const files = await listProjectFiles(p.id);
      if (files.length === 0) continue;
      const n = await indexProject(p.id, files, userId);
      if (n > 0) {
        indexed += n;
        projectsTouched++;
      }
    } catch {
      // One unreachable project should not lose the work already done for the
      // others, so it is reported by name rather than thrown.
      failed.push(p.name);
    }
  }

  return Response.json({
    ok: true,
    projects: projects.length,
    projectsIndexed: projectsTouched,
    filesIndexed: indexed,
    model: cfg.model,
    failed,
  });
}
