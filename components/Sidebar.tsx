"use client";

import { confirmDialog } from "@/lib/ui";
import { useEffect, useMemo, useState } from "react";
import type { Conversation, Project } from "@/lib/types";
import { api } from "@/lib/client";
import Icon from "./Icon";
import { ThemeButton } from "./ThemeToggle";
import type { View } from "./AppShell";

interface Props {
  open: boolean;
  onToggle: () => void;
  conversations: Conversation[];
  projects: Project[];
  view: View;
  workspace: "chat" | "design";
  onWorkspaceChange: (w: "chat" | "design") => void;
  onSelect: (view: View) => void;
  onOpenSettings: () => void;
  onOpenTasks: () => void;
  me?: { name: string; email: string } | null;
  onLogout?: () => void;
  onConversationsChanged: () => void;
  onProjectsChanged: () => void;
}

function dateGroup(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - 86_400_000) return "Yesterday";
  if (ts >= startOfToday - 7 * 86_400_000) return "Previous 7 days";
  if (ts >= startOfToday - 30 * 86_400_000) return "Previous 30 days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export default function Sidebar({
  open,
  onToggle,
  conversations,
  projects,
  view,
  workspace,
  onWorkspaceChange,
  onSelect,
  onOpenSettings,
  onOpenTasks,
  me,
  onLogout,
  onConversationsChanged,
  onProjectsChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [searchExtras, setSearchExtras] = useState<{
    projects: Project[];
    artifacts: { id: string; conversation_id: string; title: string; type: string }[];
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // Full-text search (titles + message content) via the server, debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearchExtras(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api<{
          conversations: Conversation[];
          projects: Project[];
          artifacts: { id: string; conversation_id: string; title: string; type: string }[];
        }>(`/api/search?q=${encodeURIComponent(q)}`);
        if (!stale) {
          setSearchResults(results.conversations);
          setSearchExtras({ projects: results.projects, artifacts: results.artifacts });
        }
      } catch {
        if (!stale) {
          setSearchResults(null);
          setSearchExtras(null);
        }
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const loadArchived = async () =>
    setArchived(await api<Conversation[]>("/api/conversations?archived=1"));

  useEffect(() => {
    if (archivedOpen) loadArchived();
  }, [archivedOpen, conversations]);

  const filtered = useMemo(
    () => searchResults ?? conversations,
    [searchResults, conversations]
  );

  const starred = useMemo(() => filtered.filter((c) => c.starred), [filtered]);
  const grouped = useMemo(() => {
    const rest = filtered.filter((c) => !c.starred);
    const map = new Map<string, Conversation[]>();
    for (const c of rest) {
      const g = dateGroup(c.updated_at);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      label: g,
      items: map.get(g)!,
    }));
  }, [filtered]);

  const activeConversationId = view.kind === "chat" ? view.conversationId : null;
  const activeProjectId = view.kind === "project" ? view.projectId : null;

  const patchConversation = async (id: string, patch: Record<string, unknown>) => {
    await api(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    onConversationsChanged();
    if (archivedOpen) loadArchived();
  };

  const deleteConversation = async (id: string, fromArchive = false) => {
    if (!(await confirmDialog("Delete this chat?"))) return;
    await api(`/api/conversations/${id}`, { method: "DELETE" });
    onConversationsChanged();
    if (fromArchive) loadArchived();
    if (activeConversationId === id) onSelect({ kind: "chat", conversationId: null });
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    await patchConversation(id, { title });
  };

  const submitNewProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setNewProjectName("");
    setNewProjectOpen(false);
    const project = await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    onProjectsChanged();
    onSelect({ kind: "project", projectId: project.id });
  };

  if (!open) {
    return (
      <div className="flex w-12 flex-col items-center gap-2 border-r border-line bg-surface-2 py-3">
        <IconButton title="Open sidebar" onClick={onToggle}>
          <Icon name="sidebar" size={18} />
        </IconButton>
        <IconButton
          title="New chat"
          onClick={() => onSelect({ kind: "chat", conversationId: null })}
        >
          <Icon name="plus" size={18} />
        </IconButton>
      </div>
    );
  }

  const renderRow = (c: Conversation, inArchive: boolean) => (
    <div
      key={c.id}
      className={`group flex w-full items-center rounded-lg text-sm ${
        activeConversationId === c.id ? "bg-surface" : "hover:bg-surface"
      }`}
    >
      {renamingId === c.id ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => commitRename(c.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename(c.id);
            if (e.key === "Escape") setRenamingId(null);
          }}
          className="m-1 w-full rounded border border-accent bg-surface px-1.5 py-1 text-sm outline-none"
        />
      ) : (
        <>
          <button
            onClick={() => onSelect({ kind: "chat", conversationId: c.id })}
            className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
            title={c.title}
          >
            {Boolean(c.starred) && (
              <Icon name="star" size={12} className="mr-1 inline text-amber-500" />
            )}
            {c.title}
          </button>
          {inArchive ? (
            <button
              title="Restore from archive"
              onClick={() => patchConversation(c.id, { archived: false })}
              className="hidden px-1 text-ink-muted hover:text-ink group-hover:block"
            >
              <Icon name="logout" size={14} className="rotate-180" />
            </button>
          ) : (
            <>
              <button
                title={c.starred ? "Unstar" : "Star"}
                onClick={() => patchConversation(c.id, { starred: !c.starred })}
                className={`hidden px-1 hover:text-amber-500 group-hover:block ${c.starred ? "text-amber-500" : "text-ink-muted"}`}
              >
                <Icon name="star" size={14} />
              </button>
              <button
                title="Archive"
                onClick={() => patchConversation(c.id, { archived: true })}
                className="hidden px-1 text-ink-muted hover:text-ink group-hover:block"
              >
                <Icon name="archive" size={14} />
              </button>
              <button
                title="Rename"
                onClick={() => {
                  setRenamingId(c.id);
                  setRenameValue(c.title);
                }}
                className="hidden px-1 text-ink-muted hover:text-ink group-hover:block"
              >
                <Icon name="pencil" size={14} />
              </button>
            </>
          )}
          <button
            title="Delete"
            onClick={() => deleteConversation(c.id, inArchive)}
            className="hidden px-1 pr-2 text-ink-muted hover:text-red-500 group-hover:block"
          >
            <Icon name="trash" size={14} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:h-full max-md:shadow-2xl">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button
          className="font-display text-xl font-semibold tracking-tight"
          onClick={() => onSelect({ kind: "chat", conversationId: null })}
        >
          Liberde
        </button>
        <IconButton title="Collapse sidebar" onClick={onToggle}>
          <Icon name="sidebar" size={18} />
        </IconButton>
      </div>

      {/* Workspace switcher: Chat vs the Design studio (separate app). */}
      <div className="mx-3 mb-2 flex rounded-lg border border-line bg-bg p-0.5 text-sm">
        <button
          onClick={() => onWorkspaceChange("chat")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 ${
            workspace === "chat" ? "bg-surface font-medium shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          <Icon name="message" size={14} /> Chat
        </button>
        <button
          onClick={() => onWorkspaceChange("design")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 ${
            workspace === "design" ? "bg-surface font-medium shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          <Icon name="pencil" size={14} /> Design
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => onSelect({ kind: "chat", conversationId: null })}
          className="flex w-full items-center gap-2 rounded-lg bg-accent px-3 py-2 text-left text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Icon name="plus" size={16} /> {workspace === "design" ? "New design" : "New chat"}
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          id="liberde-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles & messages…  (Ctrl+K)"
          className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="mt-1 mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Projects
          </span>
          <button
            onClick={() => {
              setNewProjectName("");
              setNewProjectOpen(true);
            }}
            title="New project"
            className="rounded px-1 text-ink-muted hover:bg-surface hover:text-ink"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect({ kind: "project", projectId: p.id })}
            className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
              activeProjectId === p.id ? "bg-surface font-medium" : "hover:bg-surface"
            }`}
          >
            <Icon name="folder" size={15} className="shrink-0 text-ink-muted" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}

        {starred.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Starred
            </div>
            {starred.map((c) => renderRow(c, false))}
          </>
        )}

        {grouped.map((group) => (
          <div key={group.label}>
            <div className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {group.label}
            </div>
            {group.items.map((c) => renderRow(c, false))}
          </div>
        ))}
        {searchExtras && searchExtras.projects.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Matching projects
            </div>
            {searchExtras.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect({ kind: "project", projectId: p.id })}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface"
              >
                <Icon name="folder" size={15} className="shrink-0 text-ink-muted" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </>
        )}
        {searchExtras && searchExtras.artifacts.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Matching artifacts
            </div>
            {searchExtras.artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() =>
                  onSelect({ kind: "chat", conversationId: a.conversation_id })
                }
                title={`Opens the chat containing "${a.title}"`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface"
              >
                <Icon name="grid" size={14} className="shrink-0 text-ink-muted" />
                <span className="truncate">{a.title}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-muted">{a.type}</span>
              </button>
            ))}
          </>
        )}
        {filtered.length === 0 &&
          !searchExtras?.projects.length &&
          !searchExtras?.artifacts.length && (
            <p className="px-2 py-2 text-sm text-ink-muted">
              {query ? "No matches." : "No chats yet."}
            </p>
          )}

        <button
          onClick={() => setArchivedOpen((v) => !v)}
          className="mt-3 mb-1 flex w-full items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
        >
          <Icon name="archive" size={13} /> Archived
          <Icon name={archivedOpen ? "chevronUp" : "chevronDown"} size={13} />
        </button>
        {archivedOpen &&
          (archived.length > 0 ? (
            archived.map((c) => renderRow(c, true))
          ) : (
            <p className="px-2 py-1 text-xs text-ink-muted">Nothing archived.</p>
          ))}
      </div>

      <div className="border-t border-line p-3">
        <button
          onClick={() => onSelect({ kind: "models" })}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface hover:text-ink ${
            view.kind === "models" ? "bg-surface font-medium" : "text-ink-muted"
          }`}
        >
          <Icon name="grid" size={15} /> Models & pricing
        </button>
        <button
          onClick={() => onSelect({ kind: "usage" })}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface hover:text-ink ${
            view.kind === "usage" ? "bg-surface font-medium" : "text-ink-muted"
          }`}
        >
          <Icon name="target" size={15} /> Usage
        </button>
        <button
          onClick={onOpenTasks}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="clock" size={15} /> Scheduled tasks
        </button>
        <button
          onClick={() => onSelect({ kind: "help" })}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="book" size={15} /> Help &amp; docs
        </button>
        <ThemeButton showLabel />
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="settings" size={15} /> Settings
        </button>
        {me && (
          <div className="mt-1 flex items-center gap-2 px-2 py-1.5 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
              {me.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-muted" title={me.email}>
              {me.name}
            </span>
            <button
              onClick={onLogout}
              title="Sign out"
              className="text-ink-muted hover:text-ink"
            >
              <Icon name="logout" size={15} />
            </button>
          </div>
        )}
      </div>

      {newProjectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewProjectOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="mb-1 font-display text-lg font-semibold">New project</h2>
            <p className="mb-3 text-sm text-ink-muted">
              Group chats with shared instructions and knowledge files.
            </p>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewProject();
                if (e.key === "Escape") setNewProjectOpen(false);
              }}
              placeholder="Project name"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setNewProjectOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={submitNewProject}
                disabled={!newProjectName.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-ink-muted hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}
