"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@/lib/types";

export default function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        )
      : models;
    return list.slice(0, 60);
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const fmtPrice = (p: string) => {
    const perMillion = Number(p) * 1_000_000;
    if (!perMillion) return "free";
    return `$${perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(0)}/M`;
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-64 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm hover:border-accent"
      >
        <span className="truncate font-medium">
          {selected?.name ?? value ?? "Select model"}
        </span>
        <span className="text-xs text-ink-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-96 max-w-[90vw] rounded-xl border border-line bg-surface shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            className="w-full border-b border-line bg-transparent px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
          />
          <div className="max-h-80 overflow-y-auto p-1">
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2 ${
                  m.id === value ? "bg-surface-2" : ""
                }`}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {fmtPrice(m.pricing.prompt)} in · {fmtPrice(m.pricing.completion)} out
                  </span>
                </span>
                <span className="flex w-full items-center gap-2 text-[11px] text-ink-muted">
                  <span className="truncate">{m.id}</span>
                  {m.supportsImages && <span title="Accepts image input (vision)">🖼</span>}
                  {m.outputsImages && <span title="Generates images">🎨</span>}
                  {m.context_length > 0 && (
                    <span className="shrink-0">
                      {Math.round(m.context_length / 1000)}k ctx
                    </span>
                  )}
                </span>
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
  );
}
