import { NextRequest } from "next/server";
import { createPrompt, deletePrompt, listPrompts } from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listPrompts(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim() || !body.body?.trim()) {
    return Response.json({ error: "name and body are required" }, { status: 400 });
  }
  return Response.json(
    await createPrompt({ name: body.name.trim().slice(0, 80), body: body.body }, userId),
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deletePrompt(id, userId);
  return Response.json({ ok: true });
}
