import { NextRequest } from "next/server";
import {
  addMemory,
  deleteMemory,
  findMemoryByPrefix,
  listMemories,
  updateMemory,
} from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listMemories(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.content?.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  return Response.json(await addMemory(body.content, userId), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.id || !body.content?.trim()) {
    return Response.json({ error: "id and content are required" }, { status: 400 });
  }
  const target = await findMemoryByPrefix(body.id, userId);
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });
  await updateMemory(target.id, body.content.trim());
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  // Only delete memories the caller owns.
  const target = await findMemoryByPrefix(id, userId);
  if (target) await deleteMemory(target.id);
  return Response.json({ ok: true });
}
