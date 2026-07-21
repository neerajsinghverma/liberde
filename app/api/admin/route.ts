import { NextRequest } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSetting, q, setSetting } from "@/lib/db";

const forbidden = () => Response.json({ error: "Admins only" }, { status: 403 });

async function requireAdmin() {
  const user = await getRequestUser();
  if (!user || !user.is_admin) return null;
  return user;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const users = await q(
    "SELECT id, email, name, is_admin, created_at FROM users ORDER BY created_at ASC"
  );
  return Response.json({
    users,
    allowSignups: (await getSetting("allow_signups", "global")) !== "0",
    me: admin.id,
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const body = await req.json();
  if (typeof body.allowSignups === "boolean") {
    await setSetting("allow_signups", body.allowSignups ? "1" : "0", "global");
  }
  if (body.userId && typeof body.isAdmin === "boolean") {
    if (body.userId === admin.id && !body.isAdmin) {
      return Response.json({ error: "You can't demote yourself" }, { status: 400 });
    }
    await q("UPDATE users SET is_admin = $1 WHERE id = $2", [
      body.isAdmin ? 1 : 0,
      body.userId,
    ]);
  }
  return GET();
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });
  if (userId === admin.id) {
    return Response.json({ error: "You can't delete yourself" }, { status: 400 });
  }
  // Remove the account and everything it owns.
  const convIds = (await q("SELECT id FROM conversations WHERE user_id = $1", [
    userId,
  ])) as { id: string }[];
  for (const { id } of convIds) {
    await q(
      "DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = $1)",
      [id]
    );
    await q("DELETE FROM artifacts WHERE conversation_id = $1", [id]);
    await q("DELETE FROM branches WHERE conversation_id = $1", [id]);
    await q("DELETE FROM messages WHERE conversation_id = $1", [id]);
  }
  for (const table of [
    "conversations",
    "projects",
    "memories",
    "skills",
    "connectors",
    "scheduled_tasks",
    "api_keys",
    "shared_chats",
    "providers",
    "settings",
    "sessions",
  ]) {
    await q(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  }
  await q("DELETE FROM project_members WHERE user_id = $1", [userId]);
  await q("DELETE FROM users WHERE id = $1", [userId]);
  return GET();
}
