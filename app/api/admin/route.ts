import { NextRequest } from "next/server";
import { getRequestUser, unlockUser, adminResetPassword } from "@/lib/auth";
import { getSetting, q, setSetting } from "@/lib/db";

const forbidden = () => Response.json({ error: "Admins only" }, { status: 403 });

async function requireAdmin() {
  const user = await getRequestUser();
  if (!user || !user.is_admin) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const sp = req.nextUrl.searchParams;
  const search = (sp.get("q") || "").trim().toLowerCase();
  const pageSize = Math.min(50, Math.max(1, parseInt(sp.get("pageSize") || "8", 10) || 8));
  const page = Math.max(0, parseInt(sp.get("page") || "0", 10) || 0);
  // Server-side search + pagination so the panel scales to thousands of users
  // (only one page is returned). `search` is parameterized; page/size are clamped ints.
  const where = search ? "WHERE lower(email) LIKE $1 OR lower(name) LIKE $1" : "";
  const params = search ? [`%${search}%`] : [];
  const total = Number(
    ((await q(`SELECT COUNT(*)::int AS n FROM users ${where}`, params))[0] as { n?: number })?.n ?? 0
  );
  const users = await q(
    `SELECT id, email, name, is_admin, created_at, locked_until, auth_provider
     FROM users ${where} ORDER BY created_at ASC LIMIT ${pageSize} OFFSET ${page * pageSize}`,
    params
  );
  return Response.json({
    users,
    total,
    page,
    pageSize,
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
  // Clear a brute-force lockout so the user can sign in again immediately.
  if (body.unlockUserId) {
    await unlockUser(String(body.unlockUserId));
  }
  // Admin-initiated password reset: returns a one-time temp password to relay.
  // Blocked for Google accounts — they have no password and sign in via Google.
  if (body.resetUserId) {
    const prov = (
      await q("SELECT auth_provider FROM users WHERE id = $1", [String(body.resetUserId)])
    )[0]?.auth_provider;
    if (prov === "google") {
      return Response.json(
        { error: "This is a Google sign-in account — it has no password to reset." },
        { status: 400 }
      );
    }
    const tempPassword = await adminResetPassword(String(body.resetUserId));
    return Response.json({ ok: true, tempPassword });
  }
  // The client refetches its current page after any mutation.
  return Response.json({ ok: true });
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
      "DELETE FROM artifact_shares WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = $1)",
      [id]
    );
    await q(
      "DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = $1)",
      [id]
    );
    await q("DELETE FROM artifacts WHERE conversation_id = $1", [id]);
    await q("DELETE FROM branches WHERE conversation_id = $1", [id]);
    await q("DELETE FROM messages WHERE conversation_id = $1", [id]);
  }
  // Shares of the deleted user's design systems (before the systems themselves).
  await q(
    "DELETE FROM design_system_shares WHERE design_system_id IN (SELECT id FROM design_systems WHERE user_id = $1)",
    [userId]
  );
  // Every table with a user_id column. http_tools notably holds a plaintext
  // auth_secret, so leaving it orphaned would keep the user's API keys at rest
  // after account deletion. design_system_shares/artifact_shares rows here are
  // the ones where this user was a RECIPIENT.
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
    "http_tools",
    "design_systems",
    "design_system_shares",
    "artifact_shares",
    "prompts",
    "generated_images",
    "push_subscriptions",
    "auth_tokens",
  ]) {
    await q(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  }
  await q("DELETE FROM project_members WHERE user_id = $1", [userId]);
  await q("DELETE FROM users WHERE id = $1", [userId]);
  return Response.json({ ok: true });
}
