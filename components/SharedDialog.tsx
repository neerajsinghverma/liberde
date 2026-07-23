"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import Icon from "./Icon";

interface SharedArtifactEntry {
  artifact_id: string;
  identifier: string;
  type: string;
  title: string;
  language: string | null;
  owner_name: string;
  shared_at: number;
  updated_at: number;
}

const typeLabel = (t: string) =>
  t === "slides" ? "Slide deck" : t === "html" ? "Interactive page" : t;

/**
 * "Shared with you": artifacts other Liberde users shared to your account.
 * Opening one clones it into a fresh Design conversation you own — edit away,
 * the original is untouched.
 */
export default function SharedDialog({
  onClose,
  onOpenCopy,
}: {
  onClose: () => void;
  onOpenCopy: (conversationId: string) => void;
}) {
  const [items, setItems] = useState<SharedArtifactEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SharedArtifactEntry[]>("/api/shared-artifacts")
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(String((e as Error).message || e));
      });
  }, []);

  const openCopy = async (item: SharedArtifactEntry) => {
    setBusyId(item.artifact_id);
    setError(null);
    try {
      const res = await api<{ conversationId: string }>("/api/shared-artifacts", {
        method: "POST",
        body: JSON.stringify({ artifactId: item.artifact_id }),
      });
      onOpenCopy(res.conversationId);
      onClose();
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Icon name="users" size={18} /> Shared with you
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          {items === null ? (
            <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
              Nothing here yet. When someone shares a design with you, it lands here —
              and you can open your own editable copy.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.artifact_id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {typeLabel(item.type)} · from {item.owner_name} ·{" "}
                      {new Date(item.shared_at).toLocaleDateString()}
                    </span>
                  </span>
                  <button
                    onClick={() => openCopy(item)}
                    disabled={busyId === item.artifact_id}
                    className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {busyId === item.artifact_id ? "Opening…" : "Open & edit a copy"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
