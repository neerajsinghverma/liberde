"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import Icon from "./Icon";
import {
  estimateWh,
  co2Grams,
  fmtWh,
  fmtCo2,
  ecoEquivalence,
  GRID_G_PER_KWH,
} from "@/lib/eco";

interface Usage {
  total: { cost: number; tokensIn: number; tokensOut: number; messages: number };
  byModel: { model: string; n: number; cost: number; tin: number; tout: number }[];
  byDay: { day: number; cost: number; n: number }[];
}

const money = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0";
const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

interface Account {
  hasApiKey: boolean;
  totalCredits?: number | null;
  totalUsage?: number | null;
  keyLimit?: number | null;
  keyUsage?: number | null;
  label?: string | null;
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [budget, setBudget] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEco, setShowEco] = useState(false);

  useEffect(() => {
    try {
      setShowEco(localStorage.getItem("liberde:showEco") === "1");
    } catch {}
    api<Usage>("/api/usage").then(setUsage).catch((e) => setError(String(e)));
    api<{ monthlyBudget?: number }>("/api/settings")
      .then((s) => setBudget(s.monthlyBudget ?? 0))
      .catch(() => {});
    api<Account>("/api/account").then(setAccount).catch(() => {});
  }, []);

  if (error) {
    return <div className="flex flex-1 items-center justify-center text-ink-muted">{error}</div>;
  }
  if (!usage) {
    return <div className="flex flex-1 items-center justify-center text-ink-muted">Loading…</div>;
  }

  // Scale the bars by cost, but fall back to reply count when no cost has been
  // recorded (external providers / older messages) — otherwise the chart looks
  // empty even though there was activity.
  const showCost = usage.byDay.some((d) => d.cost > 0);
  const metric = (d: { cost: number; n: number }) => (showCost ? d.cost : d.n);
  const maxDay = Math.max(...usage.byDay.map(metric), showCost ? 0.0001 : 1);
  const dayLabel = (day: number) => {
    const d = new Date(day * 86_400_000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Your spend and tokens across every model, from real per-reply costs.
        </p>
      </div>

      {account?.hasApiKey &&
        account.totalCredits != null &&
        account.totalUsage != null &&
        (() => {
          const remaining = account.totalCredits! - account.totalUsage!;
          // OpenRouter API keys can carry their own spend cap.
          const keyRemaining =
            account.keyLimit != null ? account.keyLimit - (account.keyUsage ?? 0) : null;
          return (
            <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <Icon name="key" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">OpenRouter balance</p>
                <p className="text-xs text-ink-muted">
                  {money(account.totalUsage!)} used of {money(account.totalCredits!)} credits
                  {keyRemaining != null && ` · this key: ${money(keyRemaining)} left`}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-display text-xl font-semibold ${remaining <= 0 ? "text-red-500" : ""}`}>
                  {money(remaining)}
                </p>
                <p className="text-xs text-ink-muted">left</p>
              </div>
            </div>
          );
        })()}

      {budget > 0 &&
        (() => {
          const now = new Date();
          const monthStartDay = Math.floor(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 86_400_000
          );
          const monthCost = usage.byDay
            .filter((d) => d.day >= monthStartDay)
            .reduce((s, d) => s + d.cost, 0);
          const pct = Math.min(100, Math.round((monthCost / budget) * 100));
          return (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">This month&apos;s budget</span>
                <span className={`text-sm ${pct >= 90 ? "text-red-500" : "text-ink-muted"}`}>
                  {money(monthCost)} of {money(budget)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pct >= 100 && (
                <p className="mt-1.5 text-xs text-red-500">
                  Budget reached — new generations are paused until next month or a higher limit.
                </p>
              )}
            </div>
          );
        })()}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total spend", value: money(usage.total.cost) },
          { label: "Replies", value: num(usage.total.messages) },
          { label: "Input tokens", value: num(usage.total.tokensIn) },
          { label: "Output tokens", value: num(usage.total.tokensOut) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="mt-0.5 text-xs text-ink-muted">{s.label}</div>
          </div>
        ))}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            <Icon name="globe" size={14} /> Environmental impact
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showEco}
              onChange={(e) => {
                setShowEco(e.target.checked);
                try {
                  localStorage.setItem("liberde:showEco", e.target.checked ? "1" : "0");
                } catch {}
              }}
              className="accent-(--color-accent)"
            />
            Show estimate
          </label>
        </div>
        {showEco &&
          (() => {
            const wh = usage.byModel.reduce(
              (sum, m) => sum + estimateWh(m.tin, m.tout, m.model),
              0
            );
            const g = co2Grams(wh);
            return (
              <div className="mt-2 rounded-xl border border-line bg-surface p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Estimated energy", value: fmtWh(wh) },
                    { label: "Estimated CO₂e", value: fmtCo2(g) },
                    { label: "In plain terms", value: ecoEquivalence(wh) },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="text-lg font-semibold">{s.value}</div>
                      <div className="mt-0.5 text-xs text-ink-muted">{s.label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
                  Rough estimate, not a measurement: energy is derived from your output
                  tokens weighted by model size (small / mid / flagship), and CO₂e uses a
                  world-average grid intensity of {GRID_G_PER_KWH} g/kWh. Real values vary
                  a lot by data center and region — treat this as an order of magnitude.
                </p>
              </div>
            );
          })()}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          <Icon name="clock" size={14} /> Last 30 days
        </h2>
        {usage.byDay.length === 0 ? (
          <p className="text-sm text-ink-muted">No activity yet.</p>
        ) : (
          <>
            <div className="flex h-40 gap-1 rounded-xl border border-line bg-surface p-3">
              {usage.byDay.map((d) => (
                <div
                  key={d.day}
                  className="group flex min-w-[8px] flex-1 flex-col items-center gap-1"
                  title={`${dayLabel(d.day)}: ${money(d.cost)} · ${d.n} replies`}
                >
                  {/* Flex-1 area gives the bar a definite height to grow into. */}
                  <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                    <div
                      className="w-full max-w-[48px] rounded-t bg-accent transition-all group-hover:opacity-80"
                      style={{ height: `${Math.max(3, (metric(d) / maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[9px] text-ink-muted">{dayLabel(d.day)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {showCost ? "Bars show daily spend." : "Bars show replies per day (no cost recorded for these messages)."}
            </p>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          <Icon name="grid" size={14} /> By model
        </h2>
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Replies</th>
                <th className="px-3 py-2 text-right font-medium">In</th>
                <th className="px-3 py-2 text-right font-medium">Out</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="max-w-0 truncate px-3 py-2" title={m.model}>{m.model}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{m.n}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{num(m.tin)}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{num(m.tout)}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(m.cost)}</td>
                </tr>
              ))}
              {usage.byModel.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                    No spend recorded yet. (External-provider models only show cost when
                    you set their prices in Settings → Providers.)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
