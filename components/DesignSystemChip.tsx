"use client";

import { useEffect, useRef, useState } from "react";
import type { DesignSystem } from "@/lib/types";
import Icon from "./Icon";

export function paletteColors(ds: DesignSystem): string[] {
  try {
    const arr = ds.palette ? JSON.parse(ds.palette) : [];
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function Swatches({ ds, size = 10 }: { ds: DesignSystem; size?: number }) {
  const colors = paletteColors(ds);
  if (!colors.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center">
      {colors.map((c, i) => (
        <span
          key={i}
          className="rounded-full border border-black/10 dark:border-white/20"
          style={{
            background: c,
            width: size,
            height: size,
            marginLeft: i === 0 ? 0 : -size / 3,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The design-system picker chip: shows the active system (with palette
 * swatches) and opens a dropdown of the user's systems + ones shared with
 * them. "+ New…" jumps to Settings → Design systems.
 */
export default function DesignSystemChip({
  systems,
  value,
  onChange,
  compact = false,
}: {
  systems: DesignSystem[];
  value: string | null;
  onChange: (id: string | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = systems.find((s) => s.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openSettings = () => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent("liberde:open-settings", { detail: { tab: "design-systems" } })
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={
          active
            ? `Design system: ${active.name} — every design follows it`
            : "Pick a design system so every design stays on brand"
        }
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
          active
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
        } ${compact ? "" : "rounded-full px-3 py-1.5 text-sm"}`}
      >
        <Icon name="palette" size={compact ? 13 : 15} />
        {active ? (
          <>
            <Swatches ds={active} size={compact ? 9 : 11} />
            <span className={compact ? "hidden max-w-28 truncate sm:inline" : "max-w-40 truncate"}>
              {active.name}
            </span>
          </>
        ) : (
          <span className={compact ? "hidden sm:inline" : ""}>
            {compact ? "Design system" : "No design system"}
          </span>
        )}
        <span className="text-[10px] opacity-70">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 max-w-[85vw] rounded-xl border border-line bg-surface p-1 text-left shadow-xl">
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2 ${
              !value ? "bg-surface-2" : ""
            }`}
          >
            <span className="text-ink-muted">None — start fresh</span>
          </button>
          {systems.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2 ${
                s.id === value ? "bg-surface-2" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Swatches ds={s} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-ink-muted">
                {s.shared
                  ? `shared by ${s.owner_name ?? "a teammate"}`
                  : s.is_default
                    ? "default"
                    : ""}
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            onClick={openSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-accent hover:bg-surface-2"
          >
            + New design system…
          </button>
        </div>
      )}
    </div>
  );
}
