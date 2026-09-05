"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@/lib/types";
import { api, streamCompare } from "@/lib/client";
import Markdown from "./Markdown";
import Icon from "./Icon";
import { byNewest, comparable, suggestDefaults } from "@/lib/compare-picks";

function fmtCost(cost: number): string {
  if (!cost) return "$0";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/** The council verdict: one model comparing the finished answers. */
interface Synthesis {
  /** How many models actually answered, and how many were asked. */
  answered?: number;
  requested?: number;
  model: string;
  text: string;
  cost: number;
  done: boolean;
  error: string | null;
}

interface Column {
  model: string;
  text: string;
  cost: number;
  tokens_in: number;
  tokens_out: number;
  done: boolean;
  error: string | null;
}

export default function ComparePanel({
  models,
  conversationId,
  truncateFromMessageId,
  currentModel,
  question,
  hasImages,
  onClose,
  onCommitted,
}: {
  models: ModelInfo[];
  conversationId: string;
  truncateFromMessageId: string;
  currentModel: string;
  question: string;
  /** The thread carries an image, so a text-only model cannot answer it. */
  hasImages?: boolean;
  onClose: () => void;
  onCommitted: (model: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    suggestDefaults(models, currentModel).filter((id) => {
      const m = models.find((x) => x.id === id);
      return !hasImages || (m?.supportsImages ?? false);
    })
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [columns, setColumns] = useState<Column[]>([]);
  const [synth, setSynth] = useState<Synthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  // The verdict can run long — a careful comparison of three detailed answers
  // is not short — and it sits above the columns, so an unbounded one squeezed
  // them into a strip. It is capped, and collapsible for when the reader wants
  // the raw answers back.
  const [verdictOpen, setVerdictOpen] = useState(true);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const abortRef = useRef<(() => void) | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.(), []);
  useEffect(() => {
    if (!picker) return;
    const onClick = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPicker(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [picker]);

  // A text-only model asked to read an image does not degrade — it 404s with
  // 'No endpoints found that support image input' and the column dies. Better
  // to say so in the picker than to spend the turn finding out.
  const canAnswer = (m: ModelInfo) => !hasImages || m.supportsImages;

  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Same eligibility rules as the defaults, and newest first: a search for
    // "claude" should surface the current one, not the oldest one still listed.
    const eligible = models.filter((m) => comparable(m, currentModel) || m.id === currentModel);
    const list = q
      ? eligible.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        )
      : [...eligible].sort(byNewest);
    return list.slice(0, 60);
  }, [models, query]);

  const toggle = (id: string) =>
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      const m = models.find((x) => x.id === id);
      if (!m || !canAnswer(m)) return s;
      return s.length >= 4 ? s : [...s, id];
    });

  const totalCost = columns.reduce((sum, c) => sum + c.cost, 0);

  const start = () => {
    if (selected.length < 2 || running) return;
    setError(null);
    setFinished(false);
    setRunning(true);
    const runModels = [...selected];
    setSynth(null);
    setColumns(
      runModels.map((model) => ({
        model,
        text: "",
        cost: 0,
        tokens_in: 0,
        tokens_out: 0,
        done: false,
        error: null,
      }))
    );
    abortRef.current = streamCompare(
      { conversationId, truncateFromMessageId, models: runModels },
      {
        onDelta: (col, text) =>
          setColumns((cols) =>
            cols.map((c, i) => (i === col ? { ...c, text: c.text + text } : c))
          ),
        onColumnDone: (col, info) =>
          setColumns((cols) =>
            cols.map((c, i) =>
              i === col
                ? {
                    ...c,
                    done: true,
                    cost: info.cost,
                    tokens_in: info.tokens_in,
                    tokens_out: info.tokens_out,
                    model: info.model || c.model,
                  }
                : c
            )
          ),
        onSynth: (evt) =>
          setSynth((s) => ({
            model: evt.model ?? s?.model ?? "",
            text: (s?.text ?? "") + (evt.delta ?? ""),
            cost: (s?.cost ?? 0) + (Number(evt.cost) || 0),
            done: Boolean(evt.done) || Boolean(s?.done),
            error: evt.error ?? s?.error ?? null,
            // Sent once, on the opening synth frame, so hold on to it rather than
            // letting the streaming deltas overwrite it with undefined.
            answered: evt.answered ?? s?.answered,
            requested: evt.requested ?? s?.requested,
          })),
        onColumnError: (col, message) =>
          setColumns((cols) =>
            cols.map((c, i) => (i === col ? { ...c, error: message } : c))
          ),
        onDone: () => {
          setRunning(false);
          setFinished(true);
        },
        onError: (message) => {
          setError(message);
          setRunning(false);
        },
      }
    );
  };

  const pickText = async (
    model: string,
    content: string,
    cost: number,
    tokensIn = 0,
    tokensOut = 0
  ) => {
    if (committing || !content.trim()) return;
    setCommitting(true);
    try {
      await api("/api/chat/compare", {
        method: "PUT",
        body: JSON.stringify({
          conversationId,
          truncateFromMessageId,
          model,
          content,
          cost,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
        }),
      });
      onCommitted(model);
      onClose();
    } catch (e) {
      setError(String((e as Error).message || e));
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[90vh] max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Icon name="sparkles" size={18} /> Second opinion
            </h2>
            <p className="truncate text-xs text-ink-muted">
              Same question, different models — pick the answer you like best.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Model selection */}
        <div className="border-b border-line px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {selected.map((id) => (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-accent"
              >
                <span className="max-w-40 truncate">{nameOf(id)}</span>
                <button
                  onClick={() => toggle(id)}
                  disabled={running}
                  className="text-accent/70 hover:text-accent disabled:opacity-40"
                  aria-label={`Remove ${nameOf(id)}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setPicker((v) => !v)}
                disabled={running || selected.length >= 4}
                className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink disabled:opacity-40"
              >
                + Add model
              </button>
              {picker && (
                <div className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[90vw] rounded-xl border border-line bg-surface shadow-xl">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models…"
                    className="w-full border-b border-line bg-transparent px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
                  />
                  <div className="max-h-72 overflow-y-auto p-1">
                    {filtered.map((m) => {
                      const eligible = canAnswer(m);
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggle(m.id)}
                          disabled={!eligible}
                          title={
                            eligible
                              ? undefined
                              : "This thread contains an image and this model cannot read one."
                          }
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                            eligible ? "hover:bg-surface-2" : "cursor-not-allowed opacity-45"
                          } ${selected.includes(m.id) ? "bg-surface-2" : ""}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{m.name}</span>
                            <span className="block truncate text-[11px] text-ink-muted">
                              {eligible ? m.id : "Can't read images"}
                            </span>
                          </span>
                          {selected.includes(m.id) && (
                            <span className="shrink-0 text-accent">✓</span>
                          )}
                        </button>
                      );
                    })}
                    {filtered.length === 0 && (
                      <p className="px-3 py-4 text-center text-sm text-ink-muted">
                        No models match.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              onClick={start}
              disabled={selected.length < 2 || running}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              <Icon
                name={running ? "refresh" : "sparkles"}
                size={14}
                className={running ? "animate-spin" : ""}
              />
              {running ? "Comparing…" : finished ? "Compare again" : "Compare"}
            </button>
            <span className="text-xs text-ink-muted">
              Runs {selected.length} models on your question — about {selected.length}× a
              normal turn.
              {hasImages && (
                <>
                  {" "}
                  Only vision models can be picked — this thread contains an image.
                </>
              )}
              {totalCost > 0 && (
                <>
                  {" "}
                  So far: <span className="font-medium">{fmtCost(totalCost)}</span>
                </>
              )}
            </span>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Columns */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
          {columns.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
              {question
                ? `Compare how each model answers: “${question.slice(0, 140)}${
                    question.length > 140 ? "…" : ""
                  }”`
                : "Pick 2–4 models above, then Compare."}
            </div>
          ) : (
            <>
          {/* The verdict leads: it is the consolidated answer, and reading it
              should not cost a scroll past three columns of source material. */}
          {synth && (
            <div className="anim-rise mb-3 shrink-0 overflow-hidden rounded-xl border border-accent/40 bg-surface-2">
              <button
                type="button"
                onClick={() => setVerdictOpen((v) => !v)}
                aria-expanded={verdictOpen}
                title={verdictOpen ? "Collapse the verdict" : "Expand the verdict"}
                className="flex w-full items-center justify-between gap-2 border-b border-accent/30 px-3 py-2 text-left hover:bg-accent/5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name="layers" size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">Council verdict</span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {synth.error
                        ? "failed"
                        : synth.done
                          ? `${nameOf(synth.model)} · ${fmtCost(synth.cost)}`
                          : `${nameOf(synth.model)} is comparing the answers…`}
                    </span>
                    {synth.answered != null &&
                    synth.requested != null &&
                    synth.answered < synth.requested ? (
                      <span className="block truncate text-[11px] text-amber-600 dark:text-amber-400">
                        Only {synth.answered} of {synth.requested} models answered
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {!synth.done && !synth.error && (
                    <Icon name="refresh" size={13} className="animate-spin text-ink-muted" />
                  )}
                  <Icon
                    name="chevronDown"
                    size={14}
                    className={`text-ink-muted transition-transform ${verdictOpen ? "" : "-rotate-90"}`}
                  />
                </span>
              </button>
              {verdictOpen && (
              <div className="max-h-[45vh] overflow-y-auto px-3 py-2 text-sm">
                {synth.error ? (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {synth.error} — the individual answers above are unaffected.
                  </p>
                ) : synth.text ? (
                  <Markdown content={synth.text} onShowArtifact={() => {}} />
                ) : (
                  <p className="text-xs text-ink-muted">…</p>
                )}
              </div>
              )}
              {verdictOpen && synth.done && !synth.error && synth.text.trim() && (
                <div className="border-t border-accent/30 p-2">
                  <button
                    onClick={() => pickText(synth.model, synth.text, synth.cost)}
                    disabled={committing}
                    className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {committing ? "Saving…" : "Use the verdict"}
                  </button>
                </div>
              )}
            </div>
          )}

            <div className="flex shrink-0 gap-3 max-md:flex-col md:min-h-[16rem] md:flex-1">
              {columns.map((col, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg max-md:w-full md:h-full md:min-w-[320px] md:flex-1 md:basis-0"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {nameOf(col.model)}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {col.done
                          ? col.error
                            ? "failed"
                            : `${fmtCost(col.cost)} · ${col.tokens_out || 0} tokens`
                          : "thinking…"}
                      </span>
                    </span>
                    {!col.done && (
                      <Icon
                        name="refresh"
                        size={13}
                        className="shrink-0 animate-spin text-ink-muted"
                      />
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm max-md:max-h-[45vh]">
                    {col.error ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{col.error}</p>
                    ) : col.text ? (
                      <Markdown content={col.text} onShowArtifact={() => {}} />
                    ) : (
                      <p className="text-xs text-ink-muted">…</p>
                    )}
                  </div>
                  <div className="border-t border-line p-2">
                    <button
                      onClick={() => pickText(col.model, col.text, col.cost, col.tokens_in, col.tokens_out)}
                      disabled={!col.done || !!col.error || !col.text.trim() || committing}
                      className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                    >
                      {committing ? "Saving…" : "Use this reply"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
