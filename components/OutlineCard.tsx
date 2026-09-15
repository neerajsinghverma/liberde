"use client";

import { useState } from "react";
import Icon from "./Icon";
import {
  DECK_DENSITIES,
  DECK_FORMATS,
  DECK_LAYOUTS,
  DECK_SIZES,
  DECK_THEMES,
  type DeckFormat,
} from "@/lib/deck-runtime";

// Types and defaults live in lib/assistant-parts.ts, alongside the parser that
// has to cope with what models actually emit. Re-exported here so anything
// importing them from this component keeps working.
import type {
  DeckOutline,
  DeckOutlineCard,
  DeckOutlineSettings,
} from "@/lib/assistant-parts";

export type { DeckOutline, DeckOutlineCard, DeckOutlineSettings };
export { DEFAULT_OUTLINE_SETTINGS } from "@/lib/assistant-parts";

const TEXT_AMOUNTS = ["brief", "medium", "detailed", "extensive"];
const IMAGE_SOURCES = [
  { id: "themed", label: "Themed graphics" },
  { id: "ai", label: "AI images" },
  { id: "stock", label: "Stock photos" },
  { id: "none", label: "No images" },
];

/**
 * The outline step, which is the single biggest reason Gamma's decks come out
 * coherent: the model proposes a card-by-card structure and you fix it BEFORE
 * anything is generated, so a wrong assumption costs one click instead of a
 * whole deck. Editing here is local; pressing Generate sends the corrected
 * outline back as an ordinary message.
 */
export default function OutlineCard({
  outline,
  interactive,
  onGenerate,
}: {
  outline: DeckOutline;
  interactive: boolean;
  onGenerate: (message: string) => void;
}) {
  const [title, setTitle] = useState(outline.title);
  const [cards, setCards] = useState<DeckOutlineCard[]>(outline.cards);
  const [settings, setSettings] = useState<DeckOutlineSettings>(outline.settings);
  const [sent, setSent] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const set = <K extends keyof DeckOutlineSettings>(key: K, value: DeckOutlineSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const format = (settings.format || "presentation") as DeckFormat;
  const sizes = DECK_SIZES[format] ?? DECK_SIZES.presentation;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= cards.length) return;
    setCards((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const update = (i: number, patch: Partial<DeckOutlineCard>) =>
    setCards((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => setCards((list) => list.filter((_, j) => j !== i));
  const add = () =>
    setCards((list) => [...list, { title: "New card", layout: "text", summary: "" }]);

  const generate = () => {
    if (!cards.length) return;
    setSent(true);
    const lines = cards.map(
      (c, i) =>
        `${i + 1}. ${c.title}` +
        (c.layout ? ` [${c.layout}]` : "") +
        (c.summary ? ` — ${c.summary}` : "")
    );
    onGenerate(
      [
        "Generate the deck now from this confirmed outline. Do not ask again and do not send another outline.",
        `Title: ${title}`,
        `Format: ${settings.format} · Theme: ${settings.theme} · Size: ${settings.size} · Density: ${
          settings.density || "medium"
        } · Text: ${settings.text} · Images: ${settings.images}` +
          (settings.tone ? ` · Tone: ${settings.tone}` : "") +
          (settings.audience ? ` · Audience: ${settings.audience}` : "") +
          (settings.language ? ` · Language: ${settings.language}` : ""),
        `Cards (${cards.length}, in this exact order):`,
        ...lines,
      ].join("\n")
    );
  };

  const disabled = !interactive || sent;
  const theme = DECK_THEMES.find((t) => t.id === settings.theme);

  // Once the deck has been built, the outline is history. Showing the editor
  // greyed out would look like something that failed to load; a plain summary
  // says what it is — the plan this deck came from.
  if (!interactive) {
    return (
      <div className="anim-rise my-3 overflow-hidden rounded-xl border border-line bg-surface-2/40">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Icon name="layers" size={14} className="shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{outline.title}</span>
          <span className="shrink-0 text-xs text-ink-muted">
            {outline.cards.length} cards · {outline.settings.theme}
          </span>
        </div>
        <ol className="px-3 py-2 text-xs text-ink-muted">
          {outline.cards.map((c, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <span className="w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{c.title}</span>
              {c.layout && <span className="shrink-0">{c.layout}</span>}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="anim-rise my-3 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-3 py-2">
        <Icon name="layers" size={15} className="shrink-0 text-accent" />
        <input
          value={title}
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Deck title"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none disabled:opacity-70"
        />
        <span className="shrink-0 text-xs text-ink-muted">{cards.length} cards</span>
      </div>

      {/* Setup: everything Gamma asks for before it generates, on one row. */}
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
        <Chip label="Format" disabled={disabled}>
          <select
            value={settings.format}
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.value as DeckFormat;
              const next = DECK_SIZES[f] ?? DECK_SIZES.presentation;
              setSettings((s) => ({
                ...s,
                format: f,
                size: next.some((x) => x.id === s.size) ? s.size : next[0].id,
              }));
            }}
            className="bg-transparent outline-none"
          >
            {DECK_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f[0].toUpperCase() + f.slice(1)}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Theme" disabled={disabled}>
          {theme && (
            <span
              aria-hidden
              className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]"
              style={{
                background: `linear-gradient(135deg, ${theme.tokens.accent} 0 50%, ${theme.tokens.accent2} 50% 100%)`,
              }}
            />
          )}
          <select
            value={settings.theme}
            disabled={disabled}
            onChange={(e) => set("theme", e.target.value)}
            className="bg-transparent outline-none"
          >
            {DECK_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Size" disabled={disabled}>
          <select
            value={settings.size}
            disabled={disabled}
            onChange={(e) => set("size", e.target.value)}
            className="bg-transparent outline-none"
          >
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Text" disabled={disabled}>
          <select
            value={settings.text}
            disabled={disabled}
            onChange={(e) => set("text", e.target.value)}
            className="bg-transparent outline-none"
          >
            {TEXT_AMOUNTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Images" disabled={disabled}>
          <select
            value={settings.images}
            disabled={disabled}
            onChange={(e) => set("images", e.target.value)}
            className="bg-transparent outline-none"
          >
            {IMAGE_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Density" disabled={disabled}>
          <select
            value={settings.density || "medium"}
            disabled={disabled}
            onChange={(e) => set("density", e.target.value)}
            className="bg-transparent outline-none"
          >
            {DECK_DENSITIES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Chip>
      </div>

      <ol className="divide-y divide-line">
        {cards.map((c, i) => (
          <li
            key={i}
            draggable={!disabled}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
              setDragIndex(null);
            }}
            className={`flex items-start gap-2 px-3 py-2 ${
              dragIndex === i ? "opacity-50" : ""
            } ${disabled ? "" : "hover:bg-surface-2/50"}`}
          >
            <span className="mt-1.5 w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <input
                value={c.title}
                disabled={disabled}
                onChange={(e) => update(i, { title: e.target.value })}
                aria-label={`Card ${i + 1} title`}
                className="w-full bg-transparent text-sm outline-none disabled:opacity-70"
              />
              <div className="flex items-center gap-1.5">
                <select
                  value={c.layout || "text"}
                  disabled={disabled}
                  onChange={(e) => update(i, { layout: e.target.value })}
                  aria-label={`Card ${i + 1} layout`}
                  className="shrink-0 bg-transparent text-[11px] text-accent outline-none disabled:opacity-70"
                >
                  {DECK_LAYOUTS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <input
                  value={c.summary || ""}
                  disabled={disabled}
                  placeholder="what goes on this card"
                  onChange={(e) => update(i, { summary: e.target.value })}
                  aria-label={`Card ${i + 1} summary`}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-ink-muted outline-none disabled:opacity-70"
                />
              </div>
            </div>
            {!disabled && (
              <div className="flex shrink-0 gap-0.5 pt-0.5">
                <RowButton title="Move up" onClick={() => move(i, i - 1)} icon="chevronUp" />
                <RowButton title="Move down" onClick={() => move(i, i + 1)} icon="chevronDown" />
                <RowButton title="Remove card" onClick={() => remove(i)} icon="trash" />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <button
          onClick={add}
          disabled={disabled}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <Icon name="plus" size={13} /> Add card
        </button>
        {sent ? (
          <span className="text-xs text-ink-muted">Outline confirmed</span>
        ) : (
          <button
            onClick={generate}
            disabled={disabled || !cards.length}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            <Icon name="sparkles" size={14} /> Generate
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <span className="text-ink-muted">{label}</span>
      {children}
    </span>
  );
}

function RowButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
