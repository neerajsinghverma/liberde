import { NextRequest } from "next/server";
import { getRequestUserId, getUserByEmail, unauthorized } from "@/lib/auth";
import {
  getDesignSystem,
  listDesignSystemShares,
  shareDesignSystem,
  unshareDesignSystem,
} from "@/lib/db";

export const runtime = "nodejs";

/** Share a design system with another Liberde user by email (owner only). */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const ds = await getDesignSystem(body.id);
  if (!ds || ds.user_id !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const target = await getUserByEmail(String(body.email ?? ""));
  if (!target) {
    return Response.json(
      { error: "No user with that email — they need a Liberde account first" },
      { status: 404 }
    );
  }
  if (target.id === userId) {
    return Response.json({ error: "That's you — it's already yours" }, { status: 400 });
  }
  await shareDesignSystem(ds.id, target.id);
  return Response.json(await listDesignSystemShares(ds.id));
}

/** Owner removes anyone; a recipient can remove themselves (leave the share). */
export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const ds = await getDesignSystem(body.id);
  if (!ds) return Response.json({ error: "Not found" }, { status: 404 });
  const targetId = String(body.userId ?? userId);
  if (ds.user_id !== userId && targetId !== userId) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  await unshareDesignSystem(ds.id, targetId);
  return Response.json(await listDesignSystemShares(ds.id));
}
