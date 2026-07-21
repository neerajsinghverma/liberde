"use client";

import { useMemo, useState } from "react";
import type { ModelInfo } from "@/lib/types";
import { api } from "@/lib/client";
import Icon from "./Icon";

const TASKS = [
  { key: "coding", label: "Code", icon: "wrench" },
  { key: "writing", label: "Writing", icon: "pencil" },
  { key: "research", label: "Research & analysis", icon: "book" },
  { key: "quick", label: "Quick everyday chat", icon: "message" },
  { key: "vision", label: "Understand images", icon: "image" },
  { key: "imagegen", label: "Generate images", icon: "sparkles" },
  { key: "longdocs", label: "Long documents", icon: "file" },
] as const;

const PRIORITIES = [
  { key: "quality", label: "Best quality" },
  { key: "balanced", label: "Balanced" },
  { key: "cheap", label: "Lowest cost" },
  { key: "fast", label: "Fastest" },
] as const;

type Task = (typeof TASKS)[number]["key"];
type Priority = (typeof PRIORITIES)[number]["key"];

const MAJOR = /^(anthropic|openai|google|x-ai|deepseek|meta-llama|mistralai|qwen)\//;
const priceOf = (m: ModelInfo) => parseFloat(m.pricing?.completion || "0") || 0;
const idName = (m: ModelInfo) => `${m.id} ${m.name}`.toLowerCase();
const isFast = (m: ModelInfo) =>
  /(flash|mini|haiku|lite|nano|turbo|small|8b|instant)/.test(idName(m));
const isFlagship = (m: ModelInfo) =>
  /(opus|gpt-5|gpt-4\.1|\bo1\b|\bo3\b|sonnet-4|3\.7-sonnet|gemini-2\.5-pro|gemini-3|grok-4|deepseek-r|\br1\b|reasoner|405b|large)/.test(
    idName(m)
  );

function recommend(
  models: ModelInfo[],
  task: Task,
  priority: Priority,
  designMode = false
): ModelInfo[] {
  // Image generation is a hard filter — only models that output images qualify.
  if (task === "imagegen") {
    const imgs = models.filter((m) => m.outputsImages);
    return [...imgs]
      .sort((a, b) => {
        if (priority === "cheap") return priceOf(a) - priceOf(b);
        if (priority === "fast") return (isFast(b) ? 1 : 0) - (isFast(a) ? 1 : 0);
        // quality/balanced: prefer pro/flagship image models, then by price desc
        const q = (m: ModelInfo) => (/pro|gpt-5/.test(idName(m)) ? 1 : 0);
        return q(b) - q(a) || priceOf(b) - priceOf(a);
      })
      .slice(0, 3);
  }
  let cands = models.filter((m) => m.context_length > 0);
  if (task === "vision") cands = cands.filter((m) => m.supportsImages);
  const major = cands.filter((m) => MAJOR.test(m.id));
  const pool = major.length ? major : cands;

  const score = (m: ModelInfo) => {
    let s = MAJOR.test(m.id) ? 10 : 0;
    const p = priceOf(m);
    if (priority === "quality") s += (isFlagship(m) ? 100 : 0) + Math.min(60, p * 2);
    if (priority === "cheap") s += 120 - Math.min(120, p * 30);
    if (priority === "fast") s += isFast(m) ? 100 : 0;
    if (priority === "balanced") {
      s += isFast(m) ? 30 : 0;
      s += isFlagship(m) ? 30 : 0;
      s += /(sonnet|gpt-4o|gemini-2\.5-flash|gpt-4\.1-mini|gpt-5-mini)/.test(idName(m)) ? 60 : 0;
    }
    // Design mode generates large, rich HTML/CSS/JS UIs — favor strong front-end
    // builders (Claude/GPT/Gemini flagships) with big output windows, and
    // downweight the tiny/fast models that produce weaker layouts.
    if (designMode) {
      if (/(claude|gpt-5|gpt-4|gemini-2\.5-pro|gemini-3)/.test(idName(m))) s += 40;
      if (isFlagship(m)) s += 40;
      if (/(sonnet|opus)/.test(idName(m))) s += 25;
      s += Math.min(20, m.context_length / 100000);
      if (isFast(m) && priority !== "fast") s -= 15;
    }
    if (task === "coding" && /(anthropic|openai|deepseek|qwen|codestral)/.test(m.id)) s += 30;
    if (task === "longdocs") s += Math.min(45, m.context_length / 50000);
    if (task === "research") s += (isFlagship(m) ? 30 : 0) + Math.min(20, m.context_length / 100000);
    if (task === "quick") s += isFast(m) ? 40 : 0;
    if (task === "writing") s += /(claude|gpt|gemini)/.test(idName(m)) ? 20 : 0;
    if (task === "vision") s += 12;
    return s;
  };

  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, 3);
}

function reasonFor(task: Task, priority: Priority): string {
  const t: Record<Task, string> = {
    coding: "writing and reviewing code",
    writing: "long-form writing",
    research: "research and analysis",
    quick: "fast everyday chat",
    vision: "understanding images",
    imagegen: "generating images",
    longdocs: "working over long documents",
  };
  const p: Record<Priority, string> = {
    quality: "you want the strongest model",
    balanced: "you want a good quality-to-cost balance",
    cheap: "you want to keep costs low",
    fast: "you want quick responses",
  };
  return `For ${t[task]} where ${p[priority]}, this is the best fit available on your account.`;
}

export default function ModelAdvisor({
  models,
  currentDefault,
  designMode = false,
  onUse,
  onClose,
}: {
  models: ModelInfo[];
  currentDefault?: string;
  designMode?: boolean;
  onUse: (id: string) => void;
  onClose: () => void;
}) {
  const [task, setTask] = useState<Task>("coding");
  const [priority, setPriority] = useState<Priority>(designMode ? "quality" : "balanced");
  const [savedDefault, setSavedDefault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  // When set, an AI pick from the free-text box overrides the heuristic result.
  const [aiPick, setAiPick] = useState<{ top: ModelInfo; alts: ModelInfo[]; reason: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const heuristic = useMemo(
    () => recommend(models, task, priority, designMode),
    [models, task, priority, designMode]
  );
  const top = aiPick?.top ?? heuristic[0];
  const alts = aiPick ? aiPick.alts : heuristic.slice(1);
  const reasonText =
    aiPick?.reason ??
    (designMode
      ? `Best available for building interactive prototypes, decks, and app UIs where ${
          { quality: "you want the strongest results", balanced: "you want a quality/cost balance", cheap: "you want to keep costs low", fast: "you want speed" }[priority]
        }.`
      : reasonFor(task, priority));

  const askAI = async () => {
    if (!text.trim()) return;
    setThinking(true);
    setAiError(null);
    try {
      const designPrefix = designMode
        ? "This is for a DESIGN tool that generates interactive prototypes, slide decks, landing pages and app UIs as rich self-contained HTML/CSS/JS — favor models that are excellent front-end/visual builders with large output. Need: "
        : "";
      const r = await api<{ modelId: string; reason: string; alternatives: string[]; error?: string }>(
        "/api/pick-model",
        { method: "POST", body: JSON.stringify({ text: designPrefix + text, task, priority }) }
      );
      const byId = (id: string) => models.find((m) => m.id === id);
      const picked = byId(r.modelId);
      if (picked) {
        setAiPick({
          top: picked,
          alts: r.alternatives.map(byId).filter(Boolean) as ModelInfo[],
          reason: r.reason,
        });
      } else {
        setAiError("Couldn't find a match — showing my best guess from your choices below.");
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      setAiError(
        /no-key/.test(msg)
          ? "Add an OpenRouter key in Settings to use AI picking — using your choices below for now."
          : "Couldn't reach the recommender — using your choices below."
      );
    } finally {
      setThinking(false);
    }
  };

  const money = (m: ModelInfo) => {
    const n = priceOf(m);
    return n ? `$${(n * 1_000_000).toFixed(2)}/M out` : "free";
  };

  const setAsDefault = async () => {
    if (!top) return;
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ defaultModel: top.id }),
      });
      setSavedDefault(top.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Icon name="sparkles" size={18} /> {designMode ? "Pick a design model" : "Help me pick a model"}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-sm font-medium">Tell me what you need (optional)</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder={
                designMode
                  ? "e.g. the best model for polished interactive slide decks, or a cheaper one for quick mockups"
                  : "e.g. Cheap model for summarizing long PDFs, or the smartest model for hard coding problems"
              }
              className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={askAI}
              disabled={!text.trim() || thinking}
              className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              <Icon name={thinking ? "refresh" : "sparkles"} size={14} className={thinking ? "animate-spin" : ""} />
              {thinking ? "Thinking…" : "Recommend from my description"}
            </button>
            {aiError && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{aiError}</p>}
            {aiPick && (
              <p className="mt-1 text-xs text-ink-muted">
                Picked from your description.{" "}
                <button onClick={() => setAiPick(null)} className="underline hover:text-ink">
                  Use my choices instead
                </button>
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Or choose by category</p>
            <div className="flex flex-wrap gap-1.5">
              {TASKS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTask(t.key);
                    setAiPick(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                    task === t.key
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  <Icon name={t.icon} size={14} /> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">What matters most?</p>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    setPriority(p.key);
                    setAiPick(null);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    priority === p.key
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {top ? (
            <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">Recommended</p>
              <p className="mt-1 font-display text-lg font-semibold">{top.name}</p>
              <p className="text-xs text-ink-muted">
                {top.id} · {money(top)} · {Math.round(top.context_length / 1000)}K context
                {top.supportsImages ? " · vision" : ""}
              </p>
              <p className="mt-2 text-sm text-ink-muted">{reasonText}</p>
              {currentDefault === top.id && (
                <p className="mt-1 text-xs text-ink-muted">This is already your default.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    onUse(top.id);
                    onClose();
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Use for this chat
                </button>
                <button
                  onClick={setAsDefault}
                  disabled={busy || savedDefault === top.id || currentDefault === top.id}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
                >
                  {savedDefault === top.id ? "✓ Set as default" : "Set as my default"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              No matching models found. Add an OpenRouter key in Settings first.
            </p>
          )}

          {alts.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
                Also good
              </p>
              <div className="space-y-1.5">
                {alts.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-1 text-xs text-ink-muted">
                        {money(m)} · {Math.round(m.context_length / 1000)}K
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        onUse(m.id);
                        onClose();
                      }}
                      className="shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
