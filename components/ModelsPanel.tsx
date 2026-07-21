"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppSettings, ModelInfo } from "@/lib/types";
import { api } from "@/lib/client";
import Icon from "./Icon";

interface Account {
  hasApiKey: boolean;
  label?: string | null;
  isFreeTier?: boolean | null;
  keyUsage?: number | null;
  keyLimit?: number | null;
  totalCredits?: number | null;
  totalUsage?: number | null;
}

type SortKey = "name" | "prompt" | "completion" | "context" | "created";

const perM = (p: string) => Number(p) * 1_000_000;
const fmtPrice = (p: string) => {
  const v = perM(p);
  if (!v) return "free";
  return `$${v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0)}`;
};

export default function ModelsPanel({
  models,
  settings,
  onStartChat,
  onDefaultChanged,
}: {
  models: ModelInfo[];
  settings: AppSettings | null;
  onStartChat: (modelId: string) => void;
  onDefaultChanged: (s: AppSettings) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{
    vision: boolean;
    tools: boolean;
    free: boolean;
    imageOut: boolean;
  }>({ vision: false, tools: false, free: false, imageOut: false });
  const [sort, setSort] = useState<SortKey>("created");
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    api<Account>("/api/account").then(setAccount).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = models;
    if (q) {
      list = list.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
      );
    }
    if (filter.vision) list = list.filter((m) => m.supportsImages);
    if (filter.tools) list = list.filter((m) => m.supportsTools);
    if (filter.imageOut) list = list.filter((m) => m.outputsImages);
    if (filter.free) {
      list = list.filter((m) => !perM(m.pricing.prompt) && !perM(m.pricing.completion));
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "prompt":
          return perM(a.pricing.prompt) - perM(b.pricing.prompt);
        case "completion":
          return perM(a.pricing.completion) - perM(b.pricing.completion);
        case "context":
          return b.context_length - a.context_length;
        case "created":
          return b.created - a.created;
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [models, query, filter, sort]);

  const setDefault = async (id: string) => {
    const saved = await api<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultModel: id }),
    });
    onDefaultChanged(saved);
  };

  const weekAgo = Date.now() / 1000 - 7 * 86400;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-line px-6 py-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Models</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Live catalog from OpenRouter — {models.length} models, prices per 1M tokens.
        </p>
        {account?.hasApiKey && account.totalCredits != null && (
          <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
            <span>
              Credits:{" "}
              <strong>
                ${(account.totalCredits - (account.totalUsage ?? 0)).toFixed(2)}
              </strong>{" "}
              remaining
            </span>
            <span className="text-xs text-ink-muted">
              ${account.totalUsage?.toFixed(2)} used of ${account.totalCredits.toFixed(2)}
              {account.isFreeTier ? " · free tier" : ""}
            </span>
          </div>
        )}
        {account && !account.hasApiKey && (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            No OpenRouter key configured — add one in Settings to see your credits
            and start chatting.
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="w-64 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
        />
        {(
          [
            ["vision", "Vision", "image"],
            ["tools", "Tools", "wrench"],
            ["imageOut", "Image gen", "sparkles"],
            ["free", "Free", "star"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
              filter[key]
                ? "border-accent bg-accent/10 font-medium text-accent"
                : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            <Icon name={icon} size={13} /> {label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
        >
          <option value="created">Newest first</option>
          <option value="name">Name</option>
          <option value="prompt">Cheapest input</option>
          <option value="completion">Cheapest output</option>
          <option value="context">Largest context</option>
        </select>
        <span className="text-xs text-ink-muted">{filtered.length} shown</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.slice(0, 120).map((m) => (
            <div
              key={m.id}
              className="flex flex-col rounded-xl border border-line bg-surface p-3.5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-sm font-semibold" title={m.name}>
                      {m.name}
                    </h3>
                    {m.created > weekAgo && (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                        NEW
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-muted" title={m.id}>
                    {m.id}
                  </p>
                </div>
                {settings?.defaultModel === m.id && (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                    DEFAULT
                  </span>
                )}
              </div>

              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                {m.description || "—"}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span title="Input price per 1M tokens">
                  in <strong>{fmtPrice(m.pricing.prompt)}</strong>
                </span>
                <span title="Output price per 1M tokens">
                  out <strong>{fmtPrice(m.pricing.completion)}</strong>
                </span>
                {m.context_length > 0 && (
                  <span className="text-ink-muted">
                    {m.context_length >= 1_000_000
                      ? `${(m.context_length / 1_000_000).toFixed(1)}M`
                      : `${Math.round(m.context_length / 1000)}k`}{" "}
                    ctx
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-ink-muted">
                  {m.supportsImages && (
                    <span title="Accepts image input (vision)">
                      <Icon name="image" size={13} />
                    </span>
                  )}
                  {m.supportsTools && (
                    <span title="Supports tools / connectors">
                      <Icon name="wrench" size={13} />
                    </span>
                  )}
                  {m.outputsImages && (
                    <span
                      title="Generates images"
                      className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1 text-[10px] font-medium text-accent"
                    >
                      <Icon name="sparkles" size={11} /> image
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onStartChat(m.id)}
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  Chat →
                </button>
                {settings?.defaultModel !== m.id && (
                  <button
                    onClick={() => setDefault(m.id)}
                    className="rounded-lg border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink"
                  >
                    Set default
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {filtered.length > 120 && (
          <p className="py-4 text-center text-sm text-ink-muted">
            Showing the first 120 — refine your search to see more.
          </p>
        )}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-muted">No models match.</p>
        )}
      </div>
    </div>
  );
}
