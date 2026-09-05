"use client";

import { confirmDialog } from "@/lib/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import Icon from "./Icon";

interface Task {
  id: string;
  name: string;
  prompt: string;
  schedule_kind: "interval" | "daily";
  interval_minutes: number | null;
  daily_time: string | null;
  web_search: number;
  enabled: number;
  next_run: number;
  last_run: number | null;
  last_conversation_id: string | null;
  last_error: string | null;
}

export default function TasksDialog({
  onClose,
  onOpenConversation,
}: {
  onClose: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"daily" | "interval">("daily");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [intervalHours, setIntervalHours] = useState(6);
  const [webSearch, setWebSearch] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setTasks(await api<Task[]>("/api/tasks")), []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim() || !prompt.trim()) return;
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        name,
        prompt,
        schedule_kind: kind,
        daily_time: dailyTime,
        interval_minutes: intervalHours * 60,
        web_search: webSearch,
      }),
    });
    setName("");
    setPrompt("");
    await load();
  };

  const toggle = async (task: Task) => {
    await api("/api/tasks", {
      method: "PATCH",
      body: JSON.stringify({ id: task.id, enabled: !task.enabled }),
    });
    await load();
  };

  const remove = async (task: Task) => {
    if (!(await confirmDialog(`Delete task "${task.name}"?`))) return;
    await api(`/api/tasks?id=${task.id}`, { method: "DELETE" });
    await load();
  };

  const runNow = async (task: Task) => {
    setBusy(task.id);
    setError(null);
    try {
      const { conversationId } = await api<{ conversationId: string }>(
        `/api/tasks/${task.id}/run`,
        { method: "POST" }
      );
      await load();
      onOpenConversation(conversationId);
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      await load();
    } finally {
      setBusy(null);
    }
  };

  // Escape closes the tasks dialog, like every other overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Icon name="clock" size={18} /> Scheduled tasks
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <p className="text-sm text-ink-muted">
            Tasks run automatically while the Liberde server is up. Each run lands in a
            new conversation (clock-prefixed) in your history.
          </p>

          <div className="space-y-2 rounded-xl border border-line p-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Task name (e.g. Morning AI news brief)"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Prompt (e.g. Summarize today's most important AI industry news.)"
              className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "daily" | "interval")}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 outline-none"
              >
                <option value="daily">Daily at</option>
                <option value="interval">Every</option>
              </select>
              {kind === "daily" ? (
                <input
                  type="time"
                  value={dailyTime}
                  onChange={(e) => setDailyTime(e.target.value)}
                  className="rounded-lg border border-line bg-bg px-2 py-1.5 outline-none"
                />
              ) : (
                <label className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={intervalHours}
                    onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
                    className="w-16 rounded-lg border border-line bg-bg px-2 py-1.5 outline-none"
                  />
                  hours
                </label>
              )}
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={webSearch}
                  onChange={(e) => setWebSearch(e.target.checked)}
                  className="accent-(--color-accent)"
                />
                Web search
              </label>
              <button
                onClick={create}
                disabled={!name.trim() || !prompt.trim()}
                className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Create task
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="divide-y divide-line rounded-xl border border-line">
            {tasks.map((t) => (
              <div key={t.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${t.enabled ? "" : "line-through opacity-60"}`}>
                    {t.name}
                  </span>
                  {Boolean(t.web_search) && <Icon name="globe" size={13} className="text-ink-muted" />}
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <button
                      onClick={() => runNow(t)}
                      disabled={busy === t.id}
                      className="rounded border border-line px-2 py-0.5 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {busy === t.id ? "Running…" : "▶ Run now"}
                    </button>
                    <button
                      onClick={() => toggle(t)}
                      className="rounded border border-line px-2 py-0.5 hover:bg-surface-2"
                    >
                      {t.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="rounded border border-line px-2 py-0.5 text-red-500 hover:bg-surface-2"
                    >
                      Delete
                    </button>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-muted" title={t.prompt}>
                  {t.prompt}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {t.schedule_kind === "daily"
                    ? `Daily at ${t.daily_time}`
                    : `Every ${Math.round((t.interval_minutes ?? 60) / 60)}h`}
                  {" · next: "}
                  {t.enabled ? new Date(t.next_run).toLocaleString() : "paused"}
                  {t.last_run && (
                    <>
                      {" · last: "}
                      {t.last_conversation_id ? (
                        <button
                          onClick={() => {
                            onOpenConversation(t.last_conversation_id!);
                            onClose();
                          }}
                          className="text-accent hover:underline"
                        >
                          {new Date(t.last_run).toLocaleString()}
                        </button>
                      ) : (
                        new Date(t.last_run).toLocaleString()
                      )}
                    </>
                  )}
                  {t.last_error && (
                    <span className="text-red-500"> · error: {t.last_error.slice(0, 80)}</span>
                  )}
                </p>
              </div>
            ))}
            {tasks.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-ink-muted">
                No scheduled tasks yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
