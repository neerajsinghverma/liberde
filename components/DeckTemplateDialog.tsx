"use client";

import { useState } from "react";
import Icon from "./Icon";
import { api } from "@/lib/client";
import { toast } from "@/lib/ui";
import type { DeckTemplate, DeckTemplateLayout } from "@/lib/deck-template";

/** What the draft endpoint hands back for the user to confirm or correct. */
interface Draft {
  name: string;
  tokens: Record<string, string>;
  fontsQuery: string | null;
  imageStyle: string | null;
  notes: string | null;
  layouts: DeckTemplateLayout[];
  layoutCss: string | null;
}

const importExternal = (url: string) =>
  // Resolved in the browser at click time rather than bundled: pdf.js is large
  // and only the handful of people who upload a PDF ever need it.
  (new Function("u", "return import(u)")(url)) as Promise<Record<string, unknown>>;

/**
 * Turn what a person already has into a Present template.
 *
 * Nothing is saved until they have seen the extraction, because reading a brand
 * off a screenshot is a guess. The preview shows the real swatches and the real
 * typefaces so a wrong accent is obvious in a glance rather than three decks
 * later.
 */
export default function DeckTemplateDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (t: DeckTemplate) => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [docText, setDocText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [withLayouts, setWithLayouts] = useState(true);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  /** Slide images, or a PDF rendered to page images. */
  const addFiles = async (files: File[]) => {
    setBusy("Reading files…");
    try {
      const next: string[] = [];
      for (const file of files) {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          next.push(...(await pdfToImages(file)));
        } else if (file.type.startsWith("image/")) {
          next.push(await fileToDataUrl(file));
        } else {
          // A brand document: its stated values beat anything read off pixels,
          // so it goes in as text rather than as an image.
          const text = await file.text().catch(() => "");
          if (text.trim()) setDocText((d) => (d ? d + "\n\n" + text : text).slice(0, 40_000));
          else toast(`Could not read ${file.name}. Paste its text instead.`, "error");
        }
      }
      if (next.length) setImages((prev) => [...prev, ...next].slice(0, 6));
    } catch (e) {
      toast(`Could not read that file: ${e}`, "error");
    } finally {
      setBusy("");
    }
  };

  const extract = async () => {
    setBusy("Reading the brand…");
    try {
      const d = await api<Draft>("/api/deck-templates/draft", {
        method: "POST",
        body: JSON.stringify({
          images,
          text: docText,
          prompt,
          withLayouts: withLayouts && images.length > 0,
        }),
      });
      setDraft(d);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("Saving…");
    try {
      const saved = await api<DeckTemplate>("/api/deck-templates", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          source: images.length ? "screenshots" : "brand-doc",
        }),
      });
      onSaved(saved);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const canExtract = Boolean(images.length || docText.trim() || prompt.trim()) && !busy;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon name="layers" size={15} className="text-accent" />
            {draft ? "Check the template" : "New deck template"}
          </span>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>

        {!draft ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-xs text-ink-muted">
              Give me a deck you already use or the brand rules you follow. Slide images
              and PDFs are read for colour, type and composition; a brand document is
              read for the values it states outright, which is more reliable.
            </p>

            <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line py-6 text-sm text-ink-muted hover:border-accent hover:text-ink">
              <Icon name="upload" size={15} />
              Choose slide images, a PDF, or a brand document
              <input
                type="file"
                multiple
                hidden
                accept="image/*,.pdf,.txt,.md"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (files.length) addFiles(files);
                }}
              />
            </label>

            {images.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 flex items-center justify-between text-[11px] text-ink-muted">
                  <span>{images.length} of 6 slides</span>
                  <button onClick={() => setImages([])} className="hover:text-ink">
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {images.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt={`Slide ${i + 1}`}
                      className="h-16 w-28 rounded border border-line object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            <textarea
              value={docText}
              onChange={(e) => setDocText(e.target.value.slice(0, 40_000))}
              placeholder="Or paste your brand guidelines: hex values, typefaces, tone."
              className="mb-3 min-h-[90px] w-full resize-y rounded-lg border border-line bg-transparent p-2.5 text-sm outline-none focus:border-accent"
            />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Anything to add — “headings are always uppercase”, “never use the old teal”"
              className="mb-3 w-full rounded-lg border border-line bg-transparent p-2.5 text-sm outline-none focus:border-accent"
            />

            <label
              className={`flex items-start gap-2 text-xs ${images.length ? "" : "opacity-50"}`}
              title={images.length ? "" : "Needs slide images to copy layouts from"}
            >
              <input
                type="checkbox"
                checked={withLayouts && images.length > 0}
                disabled={!images.length}
                onChange={(e) => setWithLayouts(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Copy the slide designs too.</span>{" "}
                <span className="text-ink-muted">
                  Reproduces the specific compositions, not just the brand. Closer to
                  your original, but long text can break a layout that was drawn for
                  short text.
                </span>
              </span>
            </label>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Template name"
              className="mb-3 w-full rounded-lg border border-line bg-transparent px-2.5 py-2 text-sm font-medium outline-none focus:border-accent"
            />

            <Preview draft={draft} />

            <div className="mt-3 grid gap-2">
              <Field label="Image style" hint="Appended to every generated picture">
                <input
                  value={draft.imageStyle ?? ""}
                  onChange={(e) => setDraft({ ...draft, imageStyle: e.target.value })}
                  className="w-full bg-transparent text-xs outline-none"
                />
              </Field>
              <Field label="Brand notes" hint="Voice and imagery direction for the model">
                <textarea
                  value={draft.notes ?? ""}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  className="min-h-[52px] w-full resize-y bg-transparent text-xs outline-none"
                />
              </Field>
            </div>

            {draft.layouts.length > 0 && (
              <div className="mt-3 rounded-lg border border-line p-2.5">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted">
                  {draft.layouts.length} layouts copied from your slides
                </div>
                <ul className="space-y-0.5 text-xs">
                  {draft.layouts.map((l) => (
                    <li key={l.id} className="flex gap-2">
                      <span className="font-medium">{l.label}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-muted">{l.hint}</span>
                    </li>
                  ))}
                </ul>
                {!draft.layoutCss && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    The layout styling did not survive checking, so these will fall back
                    to the built-in composition. The brand still applies.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          <span className="text-xs text-ink-muted">{busy}</span>
          <div className="flex gap-2">
            {draft && (
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
              >
                Back
              </button>
            )}
            <button
              disabled={draft ? Boolean(busy) : !canExtract}
              onClick={draft ? save : extract}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {draft ? "Save template" : "Read the brand"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The extracted brand, shown as the thing it will actually produce. */
function Preview({ draft }: { draft: Draft }) {
  const t = draft.tokens;
  const swatches = (
    ["bg", "surface", "ink", "muted", "accent", "accent-2"] as const
  ).filter((k) => t[k]);
  return (
    <div
      className="overflow-hidden rounded-lg border border-line"
      style={{ background: t.bg || "#fff" }}
    >
      <div
        className="m-3 p-4"
        style={{
          background: t.surface || "#fff",
          borderRadius: t.radius || "12px",
          boxShadow: t.shadow && t.shadow !== "none" ? t.shadow : undefined,
          border: t.stroke && t.stroke !== "none" ? t.stroke : undefined,
        }}
      >
        <div
          style={{
            color: t.accent,
            fontFamily: t["heading-font"],
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: (t["kicker-transform"] as "uppercase") || "uppercase",
            fontWeight: 600,
          }}
        >
          Kicker
        </div>
        <div
          style={{
            color: t.ink,
            fontFamily: t["heading-font"],
            fontSize: 26,
            lineHeight: 1.05,
            fontWeight: Number(t["heading-weight"]) || 700,
            letterSpacing: t["heading-tracking"] || "-0.02em",
            margin: "4px 0",
          }}
        >
          A heading in your brand
        </div>
        <div style={{ color: t.muted, fontFamily: t["body-font"], fontSize: 13 }}>
          And the supporting line underneath it.
        </div>
        <div
          style={{
            marginTop: 10,
            height: 4,
            width: 60,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${t.accent}, ${t["accent-2"] || t.accent})`,
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-3">
        {swatches.map((k) => (
          <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: t.ink }}>
            <span
              className="inline-block h-3 w-3 rounded-sm border border-black/10"
              style={{ background: t[k] }}
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="text-[10px] text-ink-muted">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("unreadable"));
    fr.readAsDataURL(file);
  });
}

/**
 * Render the first few pages of a PDF to images.
 *
 * A PDF is the most common way someone has a deck they cannot screenshot
 * easily, and a vision model needs pixels. Three pages is enough to read a
 * brand: a title, a content slide, and one more.
 */
async function pdfToImages(file: File, maxPages = 3): Promise<string[]> {
  const mod = (await importExternal(
    "https://esm.sh/pdfjs-dist@4.7.76/build/pdf.min.mjs"
  )) as {
    getDocument: (o: unknown) => { promise: Promise<PdfDoc> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  mod.GlobalWorkerOptions.workerSrc =
    "https://esm.sh/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await mod.getDocument({ data }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1400, Math.ceil(viewport.width));
    canvas.height = Math.ceil((canvas.width / viewport.width) * viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    const scaled = page.getViewport({ scale: canvas.width / page.getViewport({ scale: 1 }).width });
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    out.push(canvas.toDataURL("image/jpeg", 0.85));
  }
  return out;
}

interface PdfViewport {
  width: number;
  height: number;
}
interface PdfPage {
  getViewport: (o: { scale: number }) => PdfViewport;
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => {
    promise: Promise<void>;
  };
}
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
