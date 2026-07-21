import { NextRequest } from "next/server";
import {
  addProjectMember,
  getProject,
  isProjectOwner,
  listProjectMembers,
  removeProjectMember,
} from "@/lib/db";
import { getRequestUserId, getUserByEmail, unauthorized } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/** Share a project with another user by email (owner only). */
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!(await getProject(id)) || !(await isProjectOwner(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const target = await getUserByEmail(body.email ?? "");
  if (!target) {
    return Response.json(
      { error: "No user with that email — they need an account first" },
      { status: 404 }
    );
  }
  if (target.id === userId) {
    return Response.json({ error: "You already own this project" }, { status: 400 });
  }
  await addProjectMember(id, target.id);
  return Response.json(await listProjectMembers(id), { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const memberId = req.nextUrl.searchParams.get("userId");
  if (!memberId) return Response.json({ error: "userId is required" }, { status: 400 });
  // Owners can remove anyone; members can remove themselves (leave).
  if (!(await isProjectOwner(id, userId)) && memberId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await removeProjectMember(id, memberId);
  return Response.json({ ok: true });
}
