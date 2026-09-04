import { NextRequest } from "next/server";
import {
  addProjectFile,
  deleteProjectFile,
  getProject,
  isProjectOwner,
  listProjectFiles,
} from "@/lib/db";
import { indexProject } from "@/lib/rag";
import { getRequestUserId, unauthorized } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!(await getProject(id)) || !(await isProjectOwner(id, userId))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.name || typeof body.content !== "string") {
    return Response.json({ error: "name and content are required" }, { status: 400 });
  }
  const file = await addProjectFile(id, body.name, body.content);
  // Index in the background. Embedding a large upload can take longer than
  // the request should, and retrieval falls back to lexical scoring until the
  // vectors land — so the upload never waits on it and never fails because
  // of it.
  void (async () => {
    try {
      await indexProject(id, await listProjectFiles(id), userId);
    } catch (e) {
      console.error("[liberde] background indexing failed:", String(e).slice(0, 200));
    }
  })();
  return Response.json(file, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  // Only a project owner may delete its files, and the delete is scoped to
  // this project so a foreign fileId can't be removed.
  if (!(await getProject(id)) || !(await isProjectOwner(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "fileId is required" }, { status: 400 });
  await deleteProjectFile(fileId, id);
  return Response.json({ ok: true });
}
