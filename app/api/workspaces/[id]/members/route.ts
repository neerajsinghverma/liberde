import { NextRequest } from "next/server";
import { getRequestUserId, getUserByEmail, unauthorized } from "@/lib/auth";
import {
  countWorkspaceOwners,
  listWorkspaceMembers,
  removeWorkspaceMember,
  upsertWorkspaceMember,
  workspaceRole,
} from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, canAssignRole, isWorkspaceRole, type WorkspaceRole } from "@/lib/workspaces";

type Params = { params: Promise<{ id: string }> };

const forbidden = (msg = "You can't manage this workspace's members") =>
  Response.json({ error: msg }, { status: 403 });

/** The caller's role, or null when they aren't a member of this workspace. */
async function actorRole(workspaceId: string): Promise<{
  userId: string;
  role: WorkspaceRole;
} | null> {
  const userId = await getRequestUserId();
  if (!userId) return null;
  const role = await workspaceRole(workspaceId, userId);
  return role ? { userId, role } : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const actor = await actorRole(id);
  if (!actor) return (await getRequestUserId()) ? forbidden("Not a member") : unauthorized();
  if (!can(actor.role, "view")) return forbidden("Not a member");
  return Response.json(await listWorkspaceMembers(id));
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const actor = await actorRole(id);
  if (!actor) return (await getRequestUserId()) ? forbidden("Not a member") : unauthorized();

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role ?? "member";
  if (!email) return Response.json({ error: "An email is required" }, { status: 400 });
  if (!isWorkspaceRole(role)) {
    return Response.json({ error: "Unknown role" }, { status: 400 });
  }
  if (!canAssignRole(actor.role, role)) {
    return forbidden("You can't grant that role");
  }

  // Invites go to accounts that already exist. Emailing a stranger a signup
  // link is a different feature with its own abuse surface, and quietly
  // creating an account for them would be worse.
  const user = await getUserByEmail(email);
  if (!user) {
    return Response.json(
      { error: "No account with that email. They need to sign up first." },
      { status: 404 }
    );
  }

  await upsertWorkspaceMember(id, user.id, role);
  await audit({
    action: "workspace.member_added",
    userId: actor.userId,
    targetType: "workspace",
    targetId: id,
    detail: { member: user.id, email, role },
  });
  return Response.json({ ok: true, userId: user.id, role }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const actor = await actorRole(id);
  if (!actor) return (await getRequestUserId()) ? forbidden("Not a member") : unauthorized();

  const body = await req.json().catch(() => ({}));
  const memberId = String(body.userId ?? "");
  const role = body.role;
  if (!memberId) return Response.json({ error: "userId is required" }, { status: 400 });
  if (!isWorkspaceRole(role)) {
    return Response.json({ error: "Unknown role" }, { status: 400 });
  }

  const current = await workspaceRole(id, memberId);
  if (!current) return Response.json({ error: "Not a member" }, { status: 404 });
  // Both ends are checked: demoting an owner is as much an owner-level act as
  // creating one, so an admin may do neither.
  if (!canAssignRole(actor.role, role) || !canAssignRole(actor.role, current)) {
    return forbidden("You can't change that member's role");
  }
  // Losing the last owner would leave a workspace nobody can administer.
  if (current === "owner" && role !== "owner" && (await countWorkspaceOwners(id)) <= 1) {
    return Response.json(
      { error: "This is the last owner. Promote someone else first." },
      { status: 400 }
    );
  }

  await upsertWorkspaceMember(id, memberId, role);
  await audit({
    action: "workspace.member_role_changed",
    userId: actor.userId,
    targetType: "workspace",
    targetId: id,
    detail: { member: memberId, from: current, to: role },
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const actor = await actorRole(id);
  if (!actor) return (await getRequestUserId()) ? forbidden("Not a member") : unauthorized();

  const memberId = req.nextUrl.searchParams.get("userId") ?? "";
  if (!memberId) return Response.json({ error: "userId is required" }, { status: 400 });

  const current = await workspaceRole(id, memberId);
  if (!current) return Response.json({ error: "Not a member" }, { status: 404 });

  // Anyone may show themselves out; removing someone else needs the capability.
  const leaving = memberId === actor.userId;
  if (!leaving && (!can(actor.role, "members") || !canAssignRole(actor.role, current))) {
    return forbidden("You can't remove that member");
  }
  if (current === "owner" && (await countWorkspaceOwners(id)) <= 1) {
    return Response.json(
      { error: "This is the last owner. Promote someone else first." },
      { status: 400 }
    );
  }

  await removeWorkspaceMember(id, memberId);
  await audit({
    action: "workspace.member_removed",
    userId: actor.userId,
    targetType: "workspace",
    targetId: id,
    detail: { member: memberId, selfService: leaving },
  });
  return Response.json({ ok: true });
}
