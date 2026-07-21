import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/db";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listProjects(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }
  return Response.json(await createProject(body.name.trim(), body.instructions ?? "", userId), {
    status: 201,
  });
}
