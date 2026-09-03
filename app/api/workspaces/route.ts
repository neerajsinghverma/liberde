import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspacesForUser,
  updateWorkspace,
  workspaceRole,
  workspaceSpendThisMonth,
} from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/workspaces";

const NAME_MAX = 80;

/** A budget field: a positive number, or null to remove the cap. */
function budget(value: unknown, field: string): number | null | { error: string } {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `${field} must be a positive number of dollars, or null for no cap.` };
  }
  return n;
}

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const workspaces = await listWorkspacesForUser(userId);
  // Spend is what the budget fields are judged against, so it ships with them
  // rather than making every caller do a second round trip to be useful.
  return Response.json(
    await Promise.all(
      workspaces.map(async (w) => ({ ...w, spend: await workspaceSpendThisMonth(w.id) }))
    )
  );
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, NAME_MAX);
  if (!name) return Response.json({ error: "A name is required" }, { status: 400 });

  const ws = await createWorkspace(name, userId);
  await audit({
    action: "workspace.created",
    userId,
    targetType: "workspace",
    targetId: ws.id,
    detail: { name },
  });
  return Response.json(ws, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const role = await workspaceRole(id, userId);
  if (!role || !can(role, "settings")) {
    return Response.json({ error: "You can't change this workspace" }, { status: 403 });
  }

  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, NAME_MAX);
    if (!name) return Response.json({ error: "A name is required" }, { status: 400 });
    fields.name = name;
  }
  for (const [key, label] of [
    ["monthly_budget_usd", "monthlyBudgetUsd"],
    ["per_member_budget_usd", "perMemberBudgetUsd"],
  ] as const) {
    if (body[label] === undefined) continue;
    const parsed = budget(body[label], label);
    if (parsed && typeof parsed === "object") {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    fields[key] = parsed;
  }
  if (!Object.keys(fields).length) return Response.json({ ok: true });

  await updateWorkspace(id, fields);
  // Budgets are a spend control, so a change to one belongs in the trail.
  await audit({
    action: "workspace.updated",
    userId,
    targetType: "workspace",
    targetId: id,
    detail: fields,
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const role = await workspaceRole(id, userId);
  if (!role || !can(role, "destroy")) {
    return Response.json({ error: "Only an owner can delete a workspace" }, { status: 403 });
  }
  if (!(await getWorkspace(id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Membership goes; nothing a member created does. Deleting a workspace must
  // never be a way to delete other people's conversations.
  await deleteWorkspace(id);
  await audit({
    action: "workspace.deleted",
    userId,
    targetType: "workspace",
    targetId: id,
  });
  return Response.json({ ok: true });
}
