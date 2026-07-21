import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getScheduledTask } from "@/lib/db";
import { runScheduledTask } from "@/lib/scheduler";

type Params = { params: Promise<{ id: string }> };

/** Run a scheduled task immediately; returns the conversation holding the result. */
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const task = await getScheduledTask(id);
  if (!task || (task.user_id && task.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const conversationId = await runScheduledTask(task);
    return Response.json({ conversationId });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
