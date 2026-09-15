"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { api } from "@/lib/client";
import { toast } from "@/lib/ui";
import type { DeckTemplate } from "@/lib/deck-template";
import DeckTemplateDialog from "./DeckTemplateDialog";

/** What the picker hands back: which template, and how faithfully to follow it. */
export interface DeckTemplatePick {
  id: string | null;
  mode: "skin" | "layouts";
}

/**
 * Pick the template the next deck is built on.
 *
 * Two controls in one, because they are one decision: which brand, and whether
 * to follow that brand's own slide designs or only its colours and type. The
 * second only appears for a template that actually brought layouts, so the
 * choice is never offered when it would do nothing.
 */
export default function DeckTemplateChip({
  value,
  onChange,
  compact,
}: {
  value: DeckTemplatePick;
  onChange: (pick: DeckTemplatePick) => void;
  compact?: boolean;
}) {
  const [templates, setTemplates] = useState<DeckTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const loaded = useRef(false);

  const load = async () => {
    try {
      setTemplates(await api<DeckTemplate[]>("/api/deck-templates"));
    } catch {
      /* an empty list is the right fallback; the picker still offers New */
    }
  };
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    load();
  }, []);

  const active = templates.find((t) => t.id === value.id) ?? null;

  const remove = async (t: DeckTemplate) => {
    if (!confirm(`Delete the template "${t.name}"? Decks already built keep their look.`)) return;
    try {
      await api(`/api/deck-templates/${t.id}`, { method: "DELETE" });
      if (value.id === t.id) onChange({ id: null, mode: "skin" });
      await load();
    } catch (e) {
      toast(`Could not delete: ${e}`, "error");
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          title={
            active
              ? `Template: ${active.name}${active.layouts.length ? ` (${value.mode === "layouts" ? "its layouts" : "brand only"})` : ""}`
              : "Build this deck on your own template"
          }
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
            active
              ? "border-accent text-accent"
              : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {active ? <Swatch t={active} /> : <Icon name="layers" size={13} />}
          <span className={compact ? "hidden sm:inline" : ""}>
            {active ? active.name : "Template"}
          </span>
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
            <div className="absolute left-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-muted">
                Deck template
              </div>
              <button
                onClick={() => {
                  onChange({ id: null, mode: "skin" });
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                  !value.id ? "bg-accent/10 text-accent" : "hover:bg-surface-2"
                }`}
              >
                <Icon name="palette" size={13} />
                Built-in themes
              </button>

              {templates.map((t) => (
                // Two sibling controls rather than a nested one: a delete button
                // inside the select button is invalid markup and swallows the
                // click that was meant to pick the template.
                <div
                  key={t.id}
                  className={`group flex items-start rounded text-xs ${
                    value.id === t.id ? "bg-accent/10 text-accent" : "hover:bg-surface-2"
                  }`}
                >
                  <button
                    onClick={() => {
                      onChange({ id: t.id, mode: t.layouts.length ? value.mode : "skin" });
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
                  >
                    <Swatch t={t} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate text-ink-muted">
                        {SOURCE_LABEL[t.source] ?? t.source}
                        {t.layouts.length ? ` · ${t.layouts.length} own layouts` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    title="Delete this template"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => remove(t)}
                    className="mt-1.5 mr-1 shrink-0 rounded p-1 text-ink-muted opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}

              {active && active.layouts.length > 0 && (
                <div className="mt-1 border-t border-line px-2 pb-1 pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted">
                    How closely to follow it
                  </div>
                  {(
                    [
                      ["skin", "Brand only", "Its colours and type on my layouts"],
                      ["layouts", "Its own layouts", "Copy the template's slide designs"],
                    ] as const
                  ).map(([id, label, hint]) => (
                    <button
                      key={id}
                      onClick={() => onChange({ id: active.id, mode: id })}
                      className={`flex w-full flex-col items-start rounded px-2 py-1 text-left text-xs ${
                        value.mode === id ? "bg-accent/10 text-accent" : "hover:bg-surface-2"
                      }`}
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-ink-muted">{hint}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-1 border-t border-line pt-1">
                <button
                  onClick={() => {
                    setOpen(false);
                    setDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-accent hover:bg-surface-2"
                >
                  <Icon name="plus" size={13} />
                  New template from a deck or brand doc
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {dialogOpen && (
        <DeckTemplateDialog
          onClose={() => setDialogOpen(false)}
          onSaved={async (t) => {
            setDialogOpen(false);
            await load();
            onChange({ id: t.id, mode: t.layouts.length ? "layouts" : "skin" });
          }}
        />
      )}
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  screenshots: "From slide images",
  deck: "Saved from a deck",
  "brand-doc": "From brand guidelines",
  manual: "Hand-made",
};

/** The template's two key colours, so it is recognisable in a list. */
function Swatch({ t }: { t: DeckTemplate }) {
  const a = t.tokens.accent || "#888";
  const b = t.tokens["accent-2"] || t.tokens.ink || a;
  return (
    <span
      aria-hidden
      className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line"
      style={{ background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` }}
    />
  );
}
