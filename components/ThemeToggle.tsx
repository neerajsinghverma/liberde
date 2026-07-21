"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";

export type ThemePref = "system" | "light" | "dark";
const KEY = "liberde-theme";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

/** Applies `pref` to <html data-theme> and persists it; keeps in sync with the
 *  OS while on "system". Returns the current preference + a setter. */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");

  // Read the stored preference once mounted (matches the pre-hydration script).
  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as ThemePref | null) ?? "system";
    setPref(stored);
  }, []);

  // Re-resolve on OS changes while following the system.
  useEffect(() => {
    if (pref !== "system" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.setAttribute("data-theme", resolve("system"));
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  const update = useCallback((p: ThemePref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-theme", resolve(p));
  }, []);

  return [pref, update];
}

const OPTIONS: { value: ThemePref; label: string; icon: string }[] = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** Segmented System / Light / Dark control (for Settings). */
export function ThemeControl() {
  const [pref, setPref] = useThemePref();
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setPref(o.value)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            pref === o.value
              ? "bg-surface font-medium text-ink shadow-sm"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          <Icon name={o.icon} size={15} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One-click cycle button System → Light → Dark. `showLabel` renders the
 *  current mode name (for the sidebar); otherwise icon-only. */
export function ThemeButton({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [pref, setPref] = useThemePref();
  const next: Record<ThemePref, ThemePref> = {
    system: "light",
    light: "dark",
    dark: "system",
  };
  const current = OPTIONS.find((o) => o.value === pref)!;
  return (
    <button
      type="button"
      onClick={() => setPref(next[pref])}
      title={`Theme: ${current.label} — click for ${OPTIONS.find((o) => o.value === next[pref])!.label}`}
      className={
        className ??
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
      }
    >
      <Icon name={current.icon} size={15} />
      {showLabel && <span>Theme: {current.label}</span>}
    </button>
  );
}
