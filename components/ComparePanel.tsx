"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@/lib/types";
import { api, streamCompare } from "@/lib/client";
import Markdown from "./Markdown";
import Icon from "./Icon";

function fmtCost(cost: number): string {
  if (!cost) return "$0";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

// Families we like to contrast against, in priority order. We pick at most one
// model per family so the default trio spans different labs.
const FAMILIES: [RegExp, string][] = [
  [/^anthropic\/claude/, "claude"],
  [/^openai\/gpt-5/, "gpt5"],
  [/^openai\/(gpt-4|o[13])/, "gpt4"],
  [/^google\/gemini/, "gemini"],
  [/^x-ai\/grok/, "grok"],
  [/^deepseek\//, "deepseek"],
  [/^meta-llama\//, "llama"],
  [/^mistralai\//, "mistral"],
];

function familyOf(id: string): string {
  for (const [re, fam] of FAMILIES) if (re.test(id)) return fam;
  return id.split("/")[0] || id;
}

/** Default compare set: the current model + up to two from other families. */
function suggestDefaults(models: ModelInfo[], current: string): string[] {
  const picks = current ? [current] : [];
  const usedFamilies = new Set(picks.map(familyOf));
  for (const [re] of FAMILIES) {
    if (picks.length >= 3) break;
    const m = models.find(
      (x) => re.test(x.id) && !picks.includes(x.id) && !usedFamilies.has(familyOf(x.id))
    );
    if (m) {
      picks.push(m.id);
      usedFamilies.add(familyOf(m.id));
    }
  }
  // Fallback: fill from the top of the catalog if families didn't yield enough.
  for (const m of models) {
    if (picks.length >= 3) break;
    if (!picks.includes(m.id)) picks.push(m.id);
  }
  return picks.slice(0, 4);
}

/** The council verdict: one model comparing the finished answers. */
interface Synthesis {
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
  onClose,
  onCommitted,
}: {
  models: ModelInfo[];
  conversationId: string;
  truncateFromMessageId: string;
  currentModel: string;
  question: string;
  onClose: () => void;
  onCommitted: (model: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    suggestDefaults(models, currentModel)
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [columns, setColumns] = useState<Column[]>([]);
  const [synth, setSynth] = useState<Synthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
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

  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        )
      : models;
    return list.slice(0, 60);
  }, [models, query]);

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]
    );

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
                    {filtered.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => toggle(m.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 ${
                          selected.includes(m.id) ? "bg-surface-2" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {m.id}
                          </span>
                        </span>
                        {selected.includes(m.id) && (
                          <span className="shrink-0 text-accent">✓</span>
                        )}
                      </button>
                    ))}
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
        <div className="min-h-0 flex-1 overflow-auto p-4">
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
            <div className="flex gap-3 max-md:flex-col md:h-full">
              {columns.map((col, i) => (
                <div
                  key={i}
                  className="flex flex-1 basis-0 min-w-[320px] flex-col overflow-hidden rounded-xl border border-line bg-bg max-md:w-full md:h-full"
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
                  <div className="min-h-0 flex-1 px-3 py-2 text-sm md:overflow-y-auto">
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

          {synth && (
            <div className="anim-rise mt-3 overflow-hidden rounded-xl border border-accent/40 bg-surface-2">
              <div className="flex items-center justify-between gap-2 border-b border-accent/30 px-3 py-2">
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
                  </span>
                </span>
                {!synth.done && !synth.error && (
                  <Icon name="refresh" size={13} className="shrink-0 animate-spin text-ink-muted" />
                )}
              </div>
              <div className="px-3 py-2 text-sm">
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
              {synth.done && !synth.error && synth.text.trim() && (
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
