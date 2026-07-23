"use client";

import { confirmDialog } from "@/lib/ui";
import { useCallback, useEffect, useState } from "react";
import type { Conversation, Project, ProjectFile } from "@/lib/types";
import { api } from "@/lib/client";
import Icon from "./Icon";

type ProjectDetail = Project & {
  files: ProjectFile[];
  conversations: Conversation[];
  members: { user_id: string; email: string; name: string }[];
  isOwner: boolean;
};

export default function ProjectPanel({
  projectId,
  onOpenConversation,
  onNewChatInProject,
  onProjectsChanged,
  onDeleted,
}: {
  projectId: string;
  onOpenConversation: (id: string) => void;
  onNewChatInProject: (projectId: string) => void;
  onProjectsChanged: () => void;
  onDeleted: () => void;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [instructions, setInstructions] = useState("");
  const [dirty, setDirty] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<ProjectDetail>(`/api/projects/${projectId}`);
    setProject(data);
    setInstructions(data.instructions);
    setDirty(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-ink-muted">Loading…</div>;
  }

  const saveInstructions = async () => {
    await api(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ instructions }),
    });
    setDirty(false);
    onProjectsChanged();
  };

  const rename = async () => {
    const name = prompt("Project name:", project.name);
    if (!name?.trim()) return;
    await api(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    });
    await load();
    onProjectsChanged();
  };

  const remove = async () => {
    if (!(await confirmDialog(`Delete project "${project.name}"? Chats are kept but detached.`))) return;
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    onProjectsChanged();
    onDeleted();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const content = await file.text();
      await api(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ name: file.name, content }),
      });
    }
    await load();
  };

  const removeFile = async (fileId: string) => {
    await api(`/api/projects/${projectId}/files?fileId=${fileId}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-8">
      <div className="flex items-start justify-between">
        {/* max-md:pl-9 clears the floating mobile hamburger (AppShell, left-3). */}
        <div className="max-md:pl-9">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            <Icon name="folder" size={26} className="mb-1 inline text-ink-muted" /> {project.name}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Chats in this project share its instructions and knowledge files.
          </p>
        </div>
        {project.isOwner && (
          <div className="flex gap-2 text-sm">
            <button onClick={rename} className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
              Rename
            </button>
            <button onClick={remove} className="rounded-lg border border-line px-3 py-1.5 text-red-500 hover:bg-surface-2">
              Delete
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => onNewChatInProject(projectId)}
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        + New chat in project
      </button>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Shared with
        </h2>
        {project.isOwner && (
          <div className="mb-2 flex gap-2">
            <input
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              placeholder="Teammate's email"
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={async () => {
                setShareError(null);
                try {
                  await api(`/api/projects/${projectId}/members`, {
                    method: "POST",
                    body: JSON.stringify({ email: shareEmail }),
                  });
                  setShareEmail("");
                  await load();
                } catch (e) {
                  setShareError(String((e as Error).message ?? e));
                }
              }}
              disabled={!shareEmail.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Share
            </button>
          </div>
        )}
        {shareError && <p className="mb-2 text-sm text-red-500">{shareError}</p>}
        <div className="flex flex-wrap gap-2">
          {project.members.map((m) => (
            <span
              key={m.user_id}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs"
            >
              {m.name} <span className="text-ink-muted">{m.email}</span>
              {project.isOwner && (
                <button
                  onClick={async () => {
                    await api(`/api/projects/${projectId}/members?userId=${m.user_id}`, {
                      method: "DELETE",
                    });
                    await load();
                  }}
                  className="text-ink-muted hover:text-red-500"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {project.members.length === 0 && (
            <p className="text-sm text-ink-muted">
              {project.isOwner
                ? "Not shared. Members get this project's instructions and files in their own chats."
                : "Shared with you."}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Instructions
        </h2>
        <textarea
          value={instructions}
          readOnly={!project.isOwner}
          onChange={(e) => {
            setInstructions(e.target.value);
            setDirty(true);
          }}
          rows={5}
          placeholder="e.g. You are helping with the Liberde codebase. Prefer TypeScript. Be concise."
          className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {dirty && (
          <button
            onClick={saveInstructions}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            Save instructions
          </button>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Knowledge files
          </h2>
          <label
            className={`cursor-pointer rounded-lg border border-line px-3 py-1 text-sm hover:bg-surface-2 ${project.isOwner ? "" : "hidden"}`}
          >
            + Add files
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="divide-y divide-line rounded-xl border border-line">
          {project.files.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5 truncate"><Icon name="file" size={14} className="text-ink-muted" /> {f.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-ink-muted">
                  {(f.content.length / 1024).toFixed(1)} KB
                </span>
                <button
                  onClick={() => removeFile(f.id)}
                  className="text-xs text-ink-muted hover:text-red-500"
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
          {project.files.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-muted">
              No knowledge files. Text-based files added here are provided to every chat
              in this project.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Chats
        </h2>
        <div className="divide-y divide-line rounded-xl border border-line">
          {project.conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenConversation(c.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="truncate">{c.title}</span>
              <span className="shrink-0 text-xs text-ink-muted">
                {new Date(c.updated_at).toLocaleDateString()}
              </span>
            </button>
          ))}
          {project.conversations.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-muted">No chats yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
