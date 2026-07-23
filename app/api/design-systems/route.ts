import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createDesignSystem,
  deleteDesignSystem,
  getDesignSystem,
  listDesignSystems,
  listDesignSystemShares,
  setDefaultDesignSystem,
  updateDesignSystem,
} from "@/lib/db";

export const runtime = "nodejs";

/** Own design systems + ones shared with the user; owned rows include share lists. */
export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const systems = await listDesignSystems(userId);
  const withShares = await Promise.all(
    systems.map(async (s) =>
      s.user_id === userId
        ? { ...s, sharedWith: await listDesignSystemShares(s.id) }
        : { ...s, sharedWith: [] }
    )
  );
  return Response.json(withShares);
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });
  if (!body.spec?.trim()) return Response.json({ error: "Spec is required" }, { status: 400 });
  const ds = await createDesignSystem(userId, {
    name: String(body.name).trim().slice(0, 60),
    spec: String(body.spec),
    palette: typeof body.palette === "string" ? body.palette : null,
    isDefault: Boolean(body.isDefault),
  });
  return Response.json(ds, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const ds = await getDesignSystem(body.id);
  // Only the owner can edit or set default — shared recipients are read-only.
  if (!ds || ds.user_id !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (typeof body.isDefault === "boolean") {
    await setDefaultDesignSystem(userId, body.isDefault ? ds.id : null);
  }
  if (body.name != null || body.spec != null || body.palette !== undefined) {
    await updateDesignSystem(ds.id, {
      ...(body.name != null ? { name: String(body.name).trim().slice(0, 60) } : {}),
      ...(body.spec != null ? { spec: String(body.spec) } : {}),
      ...(body.palette !== undefined ? { palette: body.palette } : {}),
    });
  }
  return Response.json(await getDesignSystem(ds.id));
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const ds = await getDesignSystem(id);
  if (ds && ds.user_id === userId) await deleteDesignSystem(id);
  return Response.json({ ok: true });
}
