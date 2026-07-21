import {
  addMessage,
  computeNextRun,
  createConversation,
  getApiKey,
  listDueTasks,
  listResumableAgentRuns,
  tryLockConversation,
  unlockConversation,
  updateConversation,
  updateScheduledTask,
  type ScheduledTask,
} from "./db";
import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "./openrouter";
import { runAgentSlice } from "./agent-runner";
import { sendPushToUser } from "./push";

const TICK_MS = 60_000;

/** Start the in-process scheduler exactly once per server process. */
export function startScheduler() {
  const g = globalThis as unknown as { __liberdeScheduler?: NodeJS.Timeout };
  if (g.__liberdeScheduler) return;
  g.__liberdeScheduler = setInterval(tick, TICK_MS);
  // Catch anything already due shortly after boot.
  setTimeout(tick, 5_000);
  console.log("[liberde] task scheduler started");
}

async function tick() {
  await runSchedulerTick();
}

/**
 * One scheduler pass: run every due task and resume orphaned agent runs.
 * Called by the in-process interval (persistent servers) and by the Vercel
 * Cron endpoint /api/cron (serverless, where no interval survives).
 */
export async function runSchedulerTick(): Promise<{
  ranTasks: number;
  failedTasks: number;
}> {
  let ranTasks = 0;
  let failedTasks = 0;
  for (const task of await listDueTasks()) {
    try {
      await runScheduledTask(task);
      ranTasks++;
    } catch (e) {
      failedTasks++;
      await updateScheduledTask(task.id, { last_error: String(e).slice(0, 500) });
      console.error(`[liberde] task "${task.name}" failed:`, e);
    }
  }
  await resumeOrphanedAgentRuns();
  return { ranTasks, failedTasks };
}

/**
 * Backstop for durable agent runs whose client disconnected mid-run (so no one
 * is re-invoking /api/agent to resume them). Picks up runs untouched for a
 * while and advances them a slice at a time. The conversation lock prevents
 * double-execution with an active streamer. (Requires a persistent server; on
 * pure serverless the client-driven resume path is the primary mechanism.)
 */
async function resumeOrphanedAgentRuns() {
  let runs;
  try {
    runs = await listResumableAgentRuns(90_000);
  } catch {
    return;
  }
  for (const run of runs.slice(0, 3)) {
    if (!(await tryLockConversation(run.conversation_id))) continue; // streamer active
    try {
      const settings = await getSettings(run.user_id);
      await runAgentSlice(run, () => {}, {
        deadlineMs: Date.now() + 45_000,
        memoryEnabled: settings.memoryEnabled,
      });
    } catch (e) {
      console.error(`[liberde] agent run ${run.id} backstop failed:`, e);
    } finally {
      await unlockConversation(run.conversation_id);
    }
  }
}

/** Execute one task run: fresh conversation, one completion, results saved. */
export async function runScheduledTask(task: ScheduledTask): Promise<string> {
  // Reschedule first so a crash can't cause a tight re-run loop.
  await updateScheduledTask(task.id, {
    next_run: computeNextRun(task.schedule_kind, task.interval_minutes, task.daily_time),
  });

  const userId = task.user_id || "local";
  if (!(await getApiKey(userId))) {
    await updateScheduledTask(task.id, { last_error: "No OpenRouter API key configured" });
    throw new Error("No OpenRouter API key configured");
  }

  const settings = await getSettings(userId);
  const model = task.model || settings.defaultModel;
  const conv = await createConversation(model, null, false, userId);
  await updateConversation(conv.id, {
    title: `⏰ ${task.name} — ${new Date().toLocaleDateString()}`,
  });
  await addMessage(conv.id, "user", task.prompt);

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: await openRouterHeaders(userId),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `You are running as a scheduled task named "${task.name}". Produce a complete, self-contained answer in markdown — the user is not present to reply.`,
        },
        { role: "user", content: task.prompt },
      ],
      ...(task.web_search ? { plugins: [{ id: "web", max_results: 5 }] } : {}),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    await updateScheduledTask(task.id, { last_error: `OpenRouter ${res.status}: ${detail}` });
    throw new Error(`OpenRouter ${res.status}`);
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  await addMessage(conv.id, "assistant", message?.content ?? "(no output)", model, null, {
    annotations: message?.annotations?.length ? message.annotations : null,
  });

  await updateScheduledTask(task.id, {
    last_run: Date.now(),
    last_conversation_id: conv.id,
    last_error: null,
  });
  await sendPushToUser(userId, {
    title: `⏰ ${task.name} finished`,
    body:
      (message?.content ?? "").replace(/\s+/g, " ").slice(0, 140) ||
      "Your scheduled task completed.",
    url: `/c/${conv.id}`,
  });
  return conv.id;
}
