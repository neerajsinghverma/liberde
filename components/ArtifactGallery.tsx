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
  colors: string[];
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
  onOpenCopy,
  onClose,
}: {
  onOpen: (conversationId: string) => void;
  /** Where a copy of someone else's artifact lands once it has been cloned. */
  onOpenCopy: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  /**
   * Opening depends on whose it is.
   *
   * Your own artifact lives in a conversation you can open. Someone else's does
   * not — you have no access to their thread — so it has to be cloned into a
   * conversation of your own first. Sending a shared card to its owner's
   * conversation id would just 404.
   */
  const open = async (c: Card) => {
    if (c.owner === "mine") {
      onOpen(c.conversation_id);
      return;
    }
    if (copying) return;
    setCopying(c.id);
    setError(null);
    try {
      const res = await api<{ conversationId: string }>("/api/shared-artifacts", {
        method: "POST",
        body: JSON.stringify({ artifactId: c.id }),
      });
      onOpenCopy(res.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open a copy");
      setCopying(null);
    }
  };

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
        <div className="anim-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c)}
              disabled={copying === c.id}
              title={
                c.owner === "mine"
                  ? "Open in " + (c.conversation_title || "its conversation")
                  : "Open your own editable copy"
              }
              className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-colors hover:border-accent disabled:opacity-60"
            >
              {/* The artifact's own palette. A row of otherwise identical cards
                  is the hardest thing to scan, and colour is the only signal
                  here that survives being glanced at. */}
              <span className="flex h-1.5 w-full shrink-0">
                {(c.colors.length ? c.colors : ["var(--color-line)"]).map((col, i) => (
                  <span key={i} className="h-full flex-1" style={{ background: col }} />
                ))}
              </span>

              <span className="flex min-w-0 flex-col gap-1 p-3.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon
                    name={typeIcon(c.type)}
                    size={14}
                    className="shrink-0 text-ink-muted"
                  />
                  <span className="truncate text-sm font-medium">{c.title}</span>
                </span>

                {c.preview ? (
                  <span className="line-clamp-2 text-xs leading-relaxed text-ink-muted">
                    {c.preview}
                  </span>
                ) : (
                  <span className="text-xs italic text-ink-muted opacity-60">
                    {c.type} artifact
                  </span>
                )}

                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                  {c.share_id && (
                    <span title="Published publicly" className="shrink-0">
                      <Icon name="globe" size={11} />
                    </span>
                  )}
                  <span className="truncate">
                    {copying === c.id
                      ? "Opening a copy…"
                      : c.owner !== "mine"
                        ? c.owner + " · " + edited(c.updated_at)
                        : edited(c.updated_at)}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
