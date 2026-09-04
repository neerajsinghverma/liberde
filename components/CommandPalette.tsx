"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ModelInfo, Project } from "@/lib/types";
import Icon from "./Icon";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

export default function CommandPalette({
  open,
  onClose,
  conversations,
  projects,
  models,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  projects: Project[];
  models: ModelInfo[];
  actions: {
    newChat: () => void;
    goModels: () => void;
    goUsage: () => void;
    goArtifacts: () => void;
    openTasks: () => void;
    openSettings: () => void;
    openChat: (id: string) => void;
    openProject: (id: string) => void;
    newChatWithModel: (id: string) => void;
  };
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "new", label: "New chat", icon: "plus", run: actions.newChat },
      { id: "models", label: "Models & pricing", icon: "grid", run: actions.goModels },
      { id: "artifacts", label: "Artifacts", icon: "layers", run: actions.goArtifacts },
      { id: "usage", label: "Usage", icon: "target", run: actions.goUsage },
      { id: "tasks", label: "Scheduled tasks", icon: "clock", run: actions.openTasks },
      { id: "settings", label: "Settings", icon: "settings", run: actions.openSettings },
    ];
    const convs = conversations.slice(0, 50).map<Command>((c) => ({
      id: `c:${c.id}`,
      label: c.title,
      hint: "Chat",
      icon: "message",
      run: () => actions.openChat(c.id),
    }));
    const projs = projects.map<Command>((p) => ({
      id: `p:${p.id}`,
      label: p.name,
      hint: "Project",
      icon: "folder",
      run: () => actions.openProject(p.id),
    }));
    const mods = models.slice(0, 200).map<Command>((m) => ({
      id: `m:${m.id}`,
      label: `New chat with ${m.name}`,
      hint: "Model",
      icon: "sparkles",
      run: () => actions.newChatWithModel(m.id),
    }));
    return [...base, ...projs, ...convs, ...mods];
  }, [conversations, projects, models, actions]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands.slice(0, 40);
    return commands
      .filter(
        (c) =>
          c.label.toLowerCase().includes(query) ||
          (c.hint?.toLowerCase().includes(query) ?? false)
      )
      .slice(0, 40);
  }, [q, commands]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" size={16} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(filtered.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(active);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search chats, models, actions…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink-muted"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted">
            esc
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => runAt(i)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                i === active ? "bg-surface-2" : ""
              }`}
            >
              <Icon name={c.icon} size={15} className="shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.hint && <span className="shrink-0 text-[11px] text-ink-muted">{c.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">No matches.</p>
          )}
        </div>
      </div>
    </div>
  );
}
