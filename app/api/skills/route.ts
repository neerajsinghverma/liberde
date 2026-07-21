import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
} from "@/lib/db";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listSkills(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim() || !body.description?.trim() || !body.instructions?.trim()) {
    return Response.json(
      { error: "name, description, and instructions are required" },
      { status: 400 }
    );
  }
  if ((await listSkills(userId)).some((s) => s.name.toLowerCase() === body.name.trim().toLowerCase())) {
    return Response.json({ error: "A skill with that name exists" }, { status: 409 });
  }
  return Response.json(
    await createSkill({
      name: body.name.trim().slice(0, 60),
      description: body.description.trim().slice(0, 300),
      instructions: body.instructions.trim(),
      connectorIds: Array.isArray(body.connectorIds) ? body.connectorIds.map(String) : [],
    }, userId),
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const skill = await getSkill(body.id);
  if (!skill) return Response.json({ error: "Not found" }, { status: 404 });
  await updateSkill(skill.id, {
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled ? 1 : 0 } : {}),
    ...(body.name?.trim() ? { name: body.name.trim().slice(0, 60) } : {}),
    ...(body.description?.trim()
      ? { description: body.description.trim().slice(0, 300) }
      : {}),
    ...(body.instructions?.trim() ? { instructions: body.instructions.trim() } : {}),
    ...(Array.isArray(body.connectorIds)
      ? { connector_ids: body.connectorIds.length ? JSON.stringify(body.connectorIds.map(String)) : null }
      : {}),
  });
  return Response.json(await getSkill(skill.id));
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deleteSkill(id);
  return Response.json({ ok: true });
}
