import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  computeNextRun,
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from "@/lib/db";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listScheduledTasks(userId));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!body.name?.trim() || !body.prompt?.trim()) {
    return Response.json({ error: "name and prompt are required" }, { status: 400 });
  }
  const kind = body.schedule_kind === "daily" ? "daily" : "interval";
  const task = await createScheduledTask({
    name: body.name.trim().slice(0, 100),
    prompt: body.prompt.trim(),
    schedule_kind: kind,
    interval_minutes: kind === "interval" ? Math.max(5, Number(body.interval_minutes) || 60) : null,
    daily_time:
      kind === "daily" && /^\d{1,2}:\d{2}$/.test(body.daily_time ?? "")
        ? body.daily_time
        : kind === "daily"
          ? "09:00"
          : null,
    web_search: Boolean(body.web_search),
    model: body.model || null,
  }, userId);
  return Response.json(task, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const task = await getScheduledTask(body.id);
  if (!task || task.user_id !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (typeof body.enabled === "boolean") {
    await updateScheduledTask(task.id, {
      enabled: body.enabled ? 1 : 0,
      // Re-arm the clock when re-enabling so it doesn't fire immediately.
      ...(body.enabled
        ? {
            next_run: computeNextRun(
              task.schedule_kind,
              task.interval_minutes,
              task.daily_time
            ),
          }
        : {}),
    });
  }
  return Response.json(await getScheduledTask(task.id));
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const task = await getScheduledTask(id);
  if (!task || task.user_id !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await deleteScheduledTask(id);
  return Response.json({ ok: true });
}
