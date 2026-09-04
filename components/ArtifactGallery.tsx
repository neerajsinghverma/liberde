"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { typeIcon } from "./ArtifactPanel";
import Icon from "./Icon";

/**
 * The artifacts gallery.
 *
 * An artifact used to be reachable only through the conversation that produced
 * it, which is fine on the day you make one and useless a fortnight later when
 * you remember the deck but not the chat. This is the index: everything you
 * made and everything shared with you, newest first, searchable.
 */

interface Card {
  id: string;
  conversation_id: string;
  conversation_title: string;
  type: string;
  title: string;
  share_id: string | null;
  updated_at: number;
  preview: string;
  owner: string;
}

type Scope = "all" | "mine" | "shared";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "Yours" },
  { key: "shared", label: "Shared with you" },
];

/** Relative for anything recent, absolute once "3 weeks ago" stops helping. */
function edited(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days < 1) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 14) return "Edited " + days + "d ago";
  return (
    "Edited " +
    new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );
}

/**
 * A readable snippet from the stored source.
 *
 * The preview is raw HTML, React or Markdown, so showing it as-is fills every
 * card with angle brackets and import statements — the noise looks identical
 * across artifacts, which is the opposite of what a thumbnail is for. Stripping
 * to prose finds the words that distinguish one card from another.
 */
function snippet(preview: string, type: string): string {
  let t = preview;
  if (type === "html" || type === "react" || type === "svg") {
    t = t
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s*import[^\n]*$/gm, " ");
  }
  if (type === "markdown") t = t.replace(/^#{1,6}\s*/gm, "");
  return t.replace(/\s+/g, " ").trim().slice(0, 180);
}

export default function ArtifactGallery({
  onOpen,
  onClose,
}: {
  onOpen: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ artifacts: Card[] }>(
        "/api/artifacts?scope=" + scope
      );
      setCards(data.artifacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load artifacts");
      setCards([]);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtering client-side keeps typing instant; the server filter exists for
  // the day a library outgrows one page.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !cards) return cards ?? [];
    return cards.filter((c) =>
      (c.title + " " + c.conversation_title + " " + c.preview)
        .toLowerCase()
        .includes(needle)
    );
  }, [cards, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-lg font-medium">Artifacts</h2>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1">
            <Icon name="search" size={13} className="shrink-0 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-40 bg-transparent text-sm outline-none"
            />
          </label>
          <button
            onClick={onClose}
            title="Close"
            className="tap-target rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 px-4 py-2">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={
              "rounded-full px-2.5 py-1 text-xs transition-colors " +
              (scope === s.key
                ? "bg-accent text-white"
                : "border border-line text-ink-muted hover:text-ink")
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {error && (
          <p className="py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {cards === null && !error && (
          <p className="py-6 text-sm text-ink-muted">Loading…</p>
        )}
        {cards !== null && shown.length === 0 && !error && (
          <p className="py-6 text-sm text-ink-muted">
            {query
              ? "Nothing matches that."
              : scope === "shared"
                ? "Nobody has shared an artifact with you yet."
                : "Artifacts you build will collect here."}
          </p>
        )}
        <div className="anim-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpen(c.conversation_id)}
              title={"Open in " + (c.conversation_title || "its conversation")}
              className="flex h-52 flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-colors hover:border-accent"
            >
              <div className="min-h-0 flex-1 overflow-hidden bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
                {snippet(c.preview, c.type) || "No preview"}
              </div>
              <div className="shrink-0 border-t border-line px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <Icon name={typeIcon(c.type)} size={13} className="shrink-0 text-ink-muted" />
                  <span className="truncate text-sm font-medium">{c.title}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                  {c.share_id && <Icon name="globe" size={11} className="shrink-0" />}
                  {c.owner !== "mine" && <span className="truncate">{c.owner} ·</span>}
                  <span className="truncate">{edited(c.updated_at)}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
