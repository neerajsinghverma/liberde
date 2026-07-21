import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createPlatformApiKey,
  deletePlatformApiKey,
  listPlatformApiKeys,
} from "@/lib/db";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listPlatformApiKeys(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = (body.name || "Unnamed key").toString().slice(0, 100);
  const { record, key } = await createPlatformApiKey(name, userId);
  // The full key is returned exactly once, at creation time.
  return Response.json({ ...record, key }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deletePlatformApiKey(id, userId);
  return Response.json({ ok: true });
}
