"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { ArtifactRecord, ArtifactType, ArtifactVersion } from "@/lib/artifact-shared";
import { api } from "@/lib/client";
import { toast } from "@/lib/ui";
import ArtifactRenderer, { CodeView, CodeEditor } from "./ArtifactRenderer";
import { buildSrcDoc } from "@/lib/artifact-srcdoc";
import {
  DECK_DENSITIES,
  DECK_FORMATS,
  DECK_SIZES,
  DECK_THEMES,
  DEFAULT_DECK_THEME,
  findDeckTheme,
  readDeckAttr,
  swapDeckAttr,
  type DeckFormat,
} from "@/lib/deck-runtime";
import { templatePptxPalette, type DeckTemplate } from "@/lib/deck-template";
import Icon from "./Icon";
import { checkConformance } from "@/lib/design-system";

export type ArtifactWithVersions = ArtifactRecord & { versions: ArtifactVersion[] };

/** What the panel is showing: a persistent artifact, an ephemeral preview, or a live stream. */
export type PanelContent =
  | { kind: "artifact"; artifact: ArtifactWithVersions; version?: number }
  | {
      kind: "ephemeral";
      title: string;
      type: ArtifactType;
      language: string | null;
      content: string;
    }
  | {
      kind: "streaming";
      title: string;
      type: ArtifactType | null;
      content: string;
    };

/** Artifact type badges, drawn from the shared icon set rather than emoji:
 *  an emoji renders as a filled colour glyph next to line icons and is the
 *  one thing in a toolbar that always looks pasted in. */
const TYPE_ICONS: Record<string, string> = {
  html: "globe",
  react: "atom",
  svg: "palette",
  mermaid: "flow",
  markdown: "fileText",
  code: "code",
  slides: "presentation",
  deck: "layers",
};

export function typeIcon(type: string | null) {
  return TYPE_ICONS[type ?? "code"] ?? "code";
}

const importExternal = (url: string) =>
  // Bypass the bundler: resolved in the browser at click time.
  (new Function("u", "return import(u)")(url)) as Promise<{ default: unknown; [k: string]: unknown }>;

/**
 * Open an artifact in a new tab WITHOUT letting its (untrusted, model/attacker-
 * authored) HTML run on the liberde.ai origin. The new tab is a minimal trusted
 * shell we control; the artifact lives inside a sandboxed iframe (no
 * allow-same-origin → opaque origin), so it can't read cookies/localStorage or
 * call /api. This replaces the old `window.open(blob)` / `document.write(doc)`
 * that ran the artifact same-origin.
 */
function openArtifactSandboxed(doc: string, autoPrint = false) {
  // For the PDF path, ask the deck to print ITSELF from inside the sandbox
  // (allow-modals permits the print dialog).
  const printScript =
    "<script>window.addEventListener('load',function(){setTimeout(function(){try{print()}catch(e){}},500)})<\/script>";
  const inner = autoPrint
    ? doc.includes("</body>")
      ? doc.replace("</body>", printScript + "</body>")
      : doc + printScript
    : doc;
  const w = window.open("about:blank", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>Liberde artifact</title>' +
      "<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;position:fixed;inset:0;width:100%;height:100%}</style>" +
      "</head><body></body></html>"
  );
  w.document.close();
  const ifr = w.document.createElement("iframe");
  ifr.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
  ifr.srcdoc = inner; // property assignment — no escaping needed
  w.document.body.appendChild(ifr);
  // Hand the keyboard to the artifact. A deck opened to present is useless if
  // the first arrow key goes to the empty shell document instead of the slides.
  try {
    ifr.focus();
  } catch {
    /* a browser that refuses is no worse than before */
  }
}

export default function ArtifactPanel({
  content,
  onClose,
  onRecordUpdated,
  onVersionSaved,
  designSystem,
}: {
  content: PanelContent;
  onClose: () => void;
  onRecordUpdated: (record: ArtifactRecord) => void;
  onVersionSaved?: (artifactId: string) => void;
  /** Kept for compatibility with ChatView's prop pass; design tools now gate on
   *  the artifact type (isVisual), not the workspace. */
  designCanvas?: boolean;
  /** The system this conversation is locked to, when there is one. Used to
   *  report drift from it — never to block or rewrite the artifact. */
  designSystem?: { name: string; spec: string; palette?: string | null } | null;
}) {
  const isRenderable = (t: ArtifactType | null) =>
    t === "html" ||
    t === "react" ||
    t === "svg" ||
    t === "mermaid" ||
    t === "markdown" ||
    t === "slides" ||
    t === "deck";

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [shareOpen, setShareOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [exporting, setExporting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Design-canvas live controls (token sliders + comment-to-edit).
  const [tokens, setTokens] = useState<{ name: string; value: string }[]>([]);
  const [changedTokens, setChangedTokens] = useState<Record<string, string>>({});
  const [showAdjust, setShowAdjust] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const postToIframe = (msg: unknown) =>
    previewRef.current?.querySelector("iframe")?.contentWindow?.postMessage(msg, "*");

  // Resizable panel (desktop only): a draggable divider on the left edge sets
  // the panel width; persisted so it sticks. On mobile the panel is a
  // full-screen overlay, so the custom width is ignored there.
  const CANVAS_MIN = 360; // smallest the canvas panel itself may shrink to
  const CHAT_MIN = 420; // the chat column must always keep at least this much
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem("liberde-canvas-width"));
    if (saved && !Number.isNaN(saved)) setPanelWidth(saved);
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    // Clamp against the chat+panel container (NOT window.innerWidth — that
    // includes the sidebar, which let the chat get squeezed to a sliver).
    const container = asideRef.current?.parentElement;
    const rect = container?.getBoundingClientRect();
    const avail = rect?.width ?? window.innerWidth;
    const rightEdge = rect ? rect.right : window.innerWidth;
    const onMove = (ev: PointerEvent) => {
      const w = rightEdge - ev.clientX;
      const maxPanel = Math.max(CANVAS_MIN, avail - CHAT_MIN);
      const clamped = Math.max(CANVAS_MIN, Math.min(maxPanel, w));
      setPanelWidth(clamped);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (panelWidth) localStorage.setItem("liberde-canvas-width", String(panelWidth));
  }, [panelWidth]);

  // Resolve what to display
  let title: string, type: ArtifactType | null, language: string | null, body: string;
  let versions: ArtifactVersion[] = [];
  let record: ArtifactRecord | null = null;
  let activeVersion = 0;

  if (content.kind === "artifact") {
    record = content.artifact;
    versions = content.artifact.versions;
    const v =
      versions.find((x) => x.version === content.version) ??
      versions[versions.length - 1];
    activeVersion = v?.version ?? 0;
    title = content.artifact.title;
    type = content.artifact.type;
    language = content.artifact.language;
    body = v?.content ?? "";
  } else {
    title = content.title;
    type = content.kind === "streaming" ? (content.type as ArtifactType | null) : content.type;
    language = content.kind === "ephemeral" ? content.language : null;
    body = content.content;
  }

  const streaming = content.kind === "streaming";

  // Drift from the locked design system. Textual, so it is advisory: a colour
  // inside a gradient or a font loaded by a CDN can read as a stray. It says
  // what it found and lets a person judge, rather than pretending to a verdict.
  const conformance = useMemo(() => {
    if (!designSystem || streaming) return null;
    if (
      !(
        type === "html" ||
        type === "react" ||
        type === "svg" ||
        type === "slides" ||
        type === "deck"
      )
    ) {
      return null;
    }
    try {
      return checkConformance(body, designSystem);
    } catch {
      return null;
    }
  }, [designSystem, streaming, type, body]);

  // While streaming, show raw code (a half-written page re-rendering constantly
  // is noise) — except for decks, where watching the cards land one at a time is
  // the point, the way it is in Gamma. A deck tolerates a truncated tail because
  // the browser closes the unfinished section for us and the runtime simply sees
  // one card fewer.
  useEffect(() => {
    if (streaming) setTab(type === "deck" ? "preview" : "code");
    else if (isRenderable(type)) setTab("preview");
    else setTab("code");
    setEditing(false);
    setRuntimeError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, record?.id]);

  const [versionCursor, setVersionCursor] = useState<number | null>(null);
  useEffect(() => setVersionCursor(null), [record?.id]);
  const shownVersion =
    versionCursor ?? activeVersion;
  const shownBody =
    record && versions.length
      ? versions.find((v) => v.version === shownVersion)?.content ?? body
      : body;

  // Deck styling is stored as attributes on the deck wrapper, so changing a
  // theme is a text edit on the artifact rather than a model round-trip: the
  // iframe previews it instantly and the committed version is one attribute
  // different. That is what makes restyling free and immediate, the way it is
  // in Gamma.
  const deckAttr = (attr: string) => (type === "deck" ? readDeckAttr(shownBody, attr) : null);
  // A deck built on the user's own template records its id in the markup. Load
  // it so the preview, the full-screen views and every export render in that
  // brand rather than falling back to a built-in theme.
  const deckTemplateId = deckAttr("data-template");
  const [deckTemplate, setDeckTemplate] = useState<DeckTemplate | null>(null);
  useEffect(() => {
    if (!deckTemplateId) {
      setDeckTemplate(null);
      return;
    }
    let cancelled = false;
    api<DeckTemplate>(`/api/deck-templates/${deckTemplateId}`)
      .then((t) => {
        if (!cancelled) setDeckTemplate(t);
      })
      // A deleted template degrades to the built-in themes rather than to a
      // blank panel.
      .catch(() => {
        if (!cancelled) setDeckTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deckTemplateId]);
  /** Options every deck render needs, so the brand can never be left off one. */
  const deckOpts = (view?: "present" | "presenter") => ({
    ...(view ? { view } : {}),
    template: deckTemplate,
  });
  const deckFormat = ((deckAttr("data-format") || "presentation") as DeckFormat);
  const commitDeckAttr = async (attr: string, value: string) => {
    if (!record) return;
    const next = swapDeckAttr(shownBody, attr, value);
    if (next === shownBody) return;
    try {
      await api(`/api/artifacts/${record.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ content: next }),
      });
      onVersionSaved?.(record.id);
    } catch (e) {
      toast(`Could not save the deck style: ${e}`, "error");
    }
  };
  // Sizes are format-specific (a webpage has no 4:3), so switching format has
  // to carry the size with it or the deck ends up in a state its own picker
  // cannot show.
  const commitDeckFormat = async (fmt: string) => {
    if (!record) return;
    const sizes = DECK_SIZES[fmt as DeckFormat] ?? DECK_SIZES.presentation;
    const keep = sizes.some((s) => s.id === deckAttr("data-size"));
    const size = keep ? deckAttr("data-size")! : sizes[0].id;
    const next = swapDeckAttr(swapDeckAttr(shownBody, "data-format", fmt), "data-size", size);
    postToIframe({ __ld: "setAttr", attr: "data-size", value: size });
    try {
      await api(`/api/artifacts/${record.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ content: next }),
      });
      onVersionSaved?.(record.id);
    } catch (e) {
      toast(`Could not save the deck format: ${e}`, "error");
    }
  };

  const canPreview = isRenderable(type) && (!streaming || type === "deck");
  // "Visual" artifacts have a rendered canvas you can point at and restyle
  // (elements to click, CSS tokens to tweak) — so the design tools (Adjust,
  // Comment-to-edit) apply to them in ANY workspace, not just Design mode.
  // Markdown/mermaid/code render but have nothing to design-edit.
  const isVisual =
    type === "html" ||
    type === "react" ||
    type === "svg" ||
    type === "slides" ||
    type === "deck";
  const lc = (language || "").toLowerCase();
  const canXlsx =
    !streaming && (lc === "csv" || lc === "tsv" || /(^|\n)\s*\|[^\n]*\|/.test(shownBody));

  // Listen for the canvas bridge (token read-out + element clicks) for any
  // visual artifact — the design tools now work in Chat mode too.
  useEffect(() => {
    if (!isVisual) return;
    const onMsg = (e: MessageEvent) => {
      const d = (e.data || {}) as {
        __ld?: string;
        tokens?: { name: string; value: string }[];
        desc?: string;
      };
      if (d.__ld === "ready") {
        setChangedTokens({});
        postToIframe({ __ld: "getTokens" });
      } else if (d.__ld === "tokens") {
        setTokens(d.tokens || []);
      } else if (d.__ld === "clicked") {
        setCommentTarget(d.desc || "");
        setCommentText("");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisual]);

  // Push comment-mode state into the preview.
  useEffect(() => {
    if (isVisual) postToIframe({ __ld: "comment", on: commentMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentMode, isVisual, reloadKey]);

  // Speaker-notes edits from the slides deck (always on, not just design
  // canvas): the iframe hands back the whole updated deck HTML; persist it as
  // a new version so notes travel with the artifact. Deliberately SILENT — no
  // onVersionSaved/refresh, or the deck iframe would reload under the cursor;
  // the server holds the latest version and the iframe holds the live state.
  const notesSaveBusy = useRef(false);
  useEffect(() => {
    if (type !== "slides" && type !== "deck") return;
    const onNotes = async (e: MessageEvent) => {
      const d = (e.data || {}) as { __ld?: string; content?: string };
      if (d.__ld !== "notesSaved" || typeof d.content !== "string") return;
      if (!record || streaming || notesSaveBusy.current) return;
      const content = d.content.trim();
      if (!content || content === shownBody.trim()) return;
      notesSaveBusy.current = true;
      try {
        // Identical-content saves are a server-side no-op, so this is cheap.
        await api(`/api/artifacts/${record.id}/versions`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
      } catch {
        /* iframe stays dirty-capable; a later blur/close retries */
      } finally {
        notesSaveBusy.current = false;
      }
    };
    window.addEventListener("message", onNotes);
    return () => window.removeEventListener("message", onNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, record?.id, streaming, shownBody]);

  const setToken = (name: string, value: string) => {
    setChangedTokens((c) => ({ ...c, [name]: value }));
    postToIframe({ __ld: "setToken", name, value });
  };

  const saveTokenEdits = async () => {
    if (!record || Object.keys(changedTokens).length === 0) return;
    let updated = shownBody;
    for (const [name, val] of Object.entries(changedTokens)) {
      updated = updated.replace(
        new RegExp("(" + name + "\\s*:\\s*)[^;]+"),
        "$1" + val
      );
    }
    await api(`/api/artifacts/${record.id}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: updated }),
    });
    setChangedTokens({});
    setVersionCursor(null);
    onVersionSaved?.(record.id);
  };

  const submitComment = () => {
    if (!commentTarget || !commentText.trim() || !record) return;
    window.dispatchEvent(
      new CustomEvent("liberde-canvas", {
        detail: `In the "${title}" artifact (identifier "${record.identifier}"): change ONLY this element — ${commentTarget} — as follows: ${commentText.trim()}. Leave everything else exactly as-is.`,
      })
    );
    setCommentMode(false);
    setCommentTarget(null);
    setCommentText("");
  };

  const isColorToken = (v: string) => /^#([0-9a-f]{3,8})$|^(rgb|hsl)a?\(/i.test(v.trim());
  const lenToken = (v: string) => /^-?\d*\.?\d+(px|rem|em|%)?$/.test(v.trim());

  return (
    <div
      ref={asideRef}
      className="anim-panel relative flex w-[46%] min-w-[380px] shrink-0 flex-col border-l border-line bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-full max-lg:min-w-0"
      // maxWidth's % resolves against the flex parent (chat+panel row), so the
      // chat column always keeps >= CHAT_MIN even if a stale saved width or a
      // drag would otherwise overshoot. Only enforced on desktop.
      style={
        isDesktop
          ? { ...(panelWidth ? { width: panelWidth } : {}), maxWidth: `calc(100% - ${CHAT_MIN}px)` }
          : undefined
      }
    >
      {/* Drag-to-resize divider (desktop only). */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setPanelWidth(null)}
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 -left-1 z-40 w-2 cursor-col-resize max-lg:hidden"
      >
        <div
          className={`mx-auto h-full w-px transition-colors ${
            dragging ? "bg-accent" : "bg-transparent hover:bg-accent/50"
          }`}
        />
      </div>
      {/* While dragging, an overlay swallows pointer events so the iframe
          doesn't capture them and the drag stays smooth. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 max-lg:overflow-x-auto">
        {/* Mobile: the panel is a full-screen overlay and the toolbar overflows,
            pushing the close ✕ off-screen. Pin an always-visible Done button at
            the far left so there's a clear way back to the chat. */}
        <button
          onClick={onClose}
          className="sticky left-0 z-10 flex shrink-0 items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1 text-sm font-medium text-ink lg:hidden"
        >
          <Icon name="x" size={15} /> Done
        </button>
        <span className="max-lg:hidden">
          <Icon name={typeIcon(type)} size={16} className="text-ink-muted" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium max-lg:hidden" title={title}>
          {title}
          {streaming && <span className="ml-2 text-xs text-accent">generating…</span>}
        </span>

        {record && versions.length > 1 && (() => {
          // Step by array position so gaps in version numbers can't desync
          // the label from the displayed content.
          const idx = Math.max(
            0,
            versions.findIndex((v) => v.version === shownVersion)
          );
          return (
            <div className="flex items-center gap-1 rounded-lg border border-line px-1 text-xs">
              <button
                disabled={idx <= 0}
                onClick={() => setVersionCursor(versions[idx - 1].version)}
                className="px-1 py-0.5 disabled:opacity-30"
              >
                ‹
              </button>
              <span className="text-ink-muted">
                v{idx + 1}/{versions.length}
              </span>
              <button
                disabled={idx >= versions.length - 1}
                onClick={() => setVersionCursor(versions[idx + 1].version)}
                className="px-1 py-0.5 disabled:opacity-30"
              >
                ›
              </button>
            </div>
          );
        })()}

        {canPreview && (
          <>
            <div className="flex rounded-lg border border-line text-xs">
              <button
                onClick={() => setTab("preview")}
                className={`rounded-l-lg px-2 py-1 ${tab === "preview" ? "bg-surface-2 font-medium" : "text-ink-muted"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setTab("code")}
                className={`rounded-r-lg px-2 py-1 ${tab === "code" ? "bg-surface-2 font-medium" : "text-ink-muted"}`}
              >
                Code
              </button>
            </div>
            {tab === "preview" && (
              <button
                title="Reload preview"
                onClick={() => {
                  setRuntimeError(null);
                  setReloadKey((k) => k + 1);
                }}
                className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="refresh" size={14} />
              </button>
            )}
          </>
        )}

        {record && (
          <div className="relative">
            <button
              onClick={() => setShareOpen((v) => !v)}
              className={`rounded-lg px-2 py-1 text-xs ${record.share_id ? "bg-accent text-white" : "border border-line text-ink-muted hover:text-ink"}`}
            >
              {record.share_id ? "Published" : "Publish"}
            </button>
            {shareOpen && (
              <ShareMenu
                record={record}
                shownVersion={shownVersion}
                onUpdated={(r) => {
                  onRecordUpdated(r);
                  setShareOpen(false);
                }}
                onClose={() => setShareOpen(false)}
              />
            )}
          </div>
        )}

        {record && !streaming && (
          <>
            <button
              title="Edit this artifact yourself (saves as a new version)"
              onClick={() => {
                setEditValue(shownBody);
                setEditing(true);
              }}
              className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="pencil" />
            </button>
            <button
              title="Ask Liberde to change this artifact (select text first to target it)"
              onClick={() => {
                const selection = window.getSelection()?.toString().trim();
                const prompt = selection
                  ? `In the "${title}" artifact, change this part:\n"${selection.slice(0, 500)}"\n→ `
                  : `Update the "${title}" artifact: `;
                window.dispatchEvent(
                  new CustomEvent("liberde-prefill", { detail: prompt })
                );
              }}
              className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="message" />
            </button>
          </>
        )}
        {isVisual && canPreview && record && !streaming && tab === "preview" && (
          <>
            <button
              onClick={() => setShowAdjust((v) => !v)}
              title="Adjust design tokens (colors, spacing) live"
              className={`rounded px-2 py-1 text-xs ${showAdjust ? "bg-accent text-white" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}
            >
              Adjust
            </button>
            <button
              onClick={() => setCommentMode((v) => !v)}
              title="Select an element on the canvas to tweak just that part"
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${commentMode ? "bg-accent text-white" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}
            >
              <Icon name="crosshair" size={13} /> Select
            </button>
          </>
        )}
        {type === "slides" && !streaming && (
          <>
            <button
              title="Export as PDF (opens the deck and prints — choose 'Save as PDF')"
              onClick={() => {
                const doc = buildSrcDoc("slides", shownBody);
                if (doc) openArtifactSandboxed(doc, true);
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              PDF
            </button>
            <button
              title="Export as PowerPoint (.pptx)"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportSlidesToPptx(shownBody, record?.identifier ?? "deck");
                } catch (e) {
                  toast(`PPTX export failed: ${e}`, "error");
                } finally {
                  setExporting(false);
                }
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {exporting ? "…" : "PPTX"}
            </button>
          </>
        )}
        {type === "deck" && !streaming && (
          <>
            <DeckAttrPicker
              label="Theme"
              icon="palette"
              attr="data-theme"
              value={deckAttr("data-theme") || DEFAULT_DECK_THEME}
              options={[
                // The user's own brand sits at the top of the list, because on a
                // deck built from a template it is the answer, and the built-ins
                // are the alternatives.
                ...(deckTemplate
                  ? [
                      {
                        id: "custom",
                        label: deckTemplate.name,
                        hint: "Your template",
                      },
                    ]
                  : []),
                ...DECK_THEMES.map((t) => ({ id: t.id, label: t.label, hint: t.mood })),
              ]}
              onPreview={(v) => postToIframe({ __ld: "setAttr", attr: "data-theme", value: v })}
              onCommit={(v) => commitDeckAttr("data-theme", v)}
            />
            <DeckAttrPicker
              label="Format"
              icon="layout"
              attr="data-format"
              value={deckFormat}
              options={DECK_FORMATS.map((f) => ({ id: f, label: f[0].toUpperCase() + f.slice(1) }))}
              onPreview={(v) => postToIframe({ __ld: "setAttr", attr: "data-format", value: v })}
              onCommit={(v) => commitDeckFormat(v)}
            />
            <DeckAttrPicker
              label="Size"
              icon="maximize"
              attr="data-size"
              value={deckAttr("data-size") || "fluid"}
              options={DECK_SIZES[deckFormat].map((s) => ({ id: s.id, label: s.label }))}
              onPreview={(v) => postToIframe({ __ld: "setAttr", attr: "data-size", value: v })}
              onCommit={(v) => commitDeckAttr("data-size", v)}
            />
            <DeckAttrPicker
              label="Density"
              icon="type"
              attr="data-density"
              value={deckAttr("data-density") || "medium"}
              options={DECK_DENSITIES}
              onPreview={(v) => postToIframe({ __ld: "setAttr", attr: "data-density", value: v })}
              onCommit={(v) => commitDeckAttr("data-density", v)}
            />
            <button
              title="Present full screen (arrow keys, S for spotlight, N for notes)"
              onClick={() => {
                const doc = buildSrcDoc("deck", shownBody, deckOpts("present"));
                if (doc) openArtifactSandboxed(doc);
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Present
            </button>
            <button
              title="Presenter view: notes, timer and the next card, in a second window you keep on your own screen"
              onClick={() => {
                const doc = buildSrcDoc("deck", shownBody, deckOpts("presenter"));
                if (doc) openArtifactSandboxed(doc);
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Notes view
            </button>
            <button
              title="Export as PDF (opens the deck and prints — choose 'Save as PDF')"
              onClick={() => {
                const doc = buildSrcDoc("deck", shownBody, deckOpts());
                if (doc) openArtifactSandboxed(doc, true);
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              PDF
            </button>
            <button
              title="Export as PowerPoint (.pptx) with this deck's theme colours"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportDeckToPptx(shownBody, record?.identifier ?? "deck", deckTemplate);
                } catch (e) {
                  toast(`PPTX export failed: ${e}`, "error");
                } finally {
                  setExporting(false);
                }
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {exporting ? "…" : "PPTX"}
            </button>
            {record && (
              // The most faithful way to make a template: get one deck right by
              // hand, then freeze it. Nothing is inferred, because the deck
              // already states its own theme.
              <button
                title="Save this deck's look as a reusable template"
                disabled={exporting}
                onClick={async () => {
                  const name = prompt("Name this template", title || "My template");
                  if (!name?.trim()) return;
                  setExporting(true);
                  try {
                    const saved = await api<DeckTemplate>("/api/deck-templates/from-deck", {
                      method: "POST",
                      body: JSON.stringify({ artifactId: record.id, name: name.trim() }),
                    });
                    toast(`Saved "${saved.name}". Pick it on your next deck.`, "success");
                  } catch (e) {
                    toast(`Could not save the template: ${e}`, "error");
                  } finally {
                    setExporting(false);
                  }
                }}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <Icon name="layers" size={13} />
                <span className="hidden xl:inline">Save template</span>
              </button>
            )}
            {record?.share_id && <DeckAnalyticsChip artifactId={record.id} />}
            <button
              title="Export every card as a PNG (a .zip)"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportDeckToPngZip(shownBody, record?.identifier ?? "deck", deckTemplate);
                } catch (e) {
                  toast(`PNG export failed: ${e}`, "error");
                } finally {
                  setExporting(false);
                }
              }}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {exporting ? "…" : "PNG"}
            </button>
          </>
        )}
        {canXlsx && (
          <button
            title="Export table to Excel (.xlsx)"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await exportToXlsx(shownBody, language, record?.identifier ?? "data");
              } catch (e) {
                toast(`Excel export failed: ${e}`, "error");
              } finally {
                setExporting(false);
              }
            }}
            className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {exporting ? "…" : "XLSX"}
          </button>
        )}
        {type === "markdown" && !streaming && (
          <button
            title="Export as Word document (.doc)"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await exportMarkdownToDoc(shownBody, record?.identifier ?? "document");
              } catch (e) {
                toast(`Word export failed: ${e}`, "error");
              } finally {
                setExporting(false);
              }
            }}
            className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {exporting ? "…" : "DOC"}
          </button>
        )}
        {canPreview && type !== "markdown" && (
          <button
            title={
              type === "slides" || type === "deck"
                ? "Present full screen (print for PDF)"
                : "Open full screen"
            }
            onClick={() => {
              const doc = buildSrcDoc(
                type!,
                shownBody,
                type === "deck" ? deckOpts("present") : undefined
              );
              if (doc) openArtifactSandboxed(doc);
            }}
            className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="maximize" />
          </button>
        )}
        {record?.share_id && canPreview && !streaming && (
          <button
            title="Open the live hosted page (public URL, copied to clipboard)"
            onClick={() => {
              const url = `${window.location.origin}/live/${record.share_id}`;
              navigator.clipboard?.writeText(url).catch(() => {});
              window.open(url, "_blank");
            }}
            className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Live
          </button>
        )}
        <button
          title="Download"
          onClick={() => {
            const ext =
              type === "react" ? "tsx" : type === "markdown" ? "md" : type === "mermaid" ? "mmd" : type === "svg" ? "svg" : type === "html" || type === "slides" || type === "deck" ? "html" : language || "txt";
            // Decks and slides download as a self-contained playable document,
            // not raw sections: the runtime travels with the file so it still
            // presents, prints and switches themes offline.
            const data =
              type === "slides" || type === "deck"
                ? (buildSrcDoc(type, shownBody, type === "deck" ? deckOpts() : undefined) ?? shownBody)
                : shownBody;
            const blob = new Blob([data], { type: "text/plain" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${(record?.identifier ?? "artifact").replace(/[^\w-]/g, "")}.${ext}`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="download" />
        </button>
        <button
          title="Close"
          onClick={onClose}
          className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="x" />
        </button>
      </div>

      {conformance && designSystem ? (
        <BrandCheck system={designSystem.name} result={conformance} />
      ) : null}

      {record && !streaming && !editing && type && (
        <CanvasBar
          type={type}
          onAction={(instruction) => {
            window.dispatchEvent(
              new CustomEvent("liberde-canvas", {
                detail: `In the "${title}" artifact (identifier "${record.identifier}"): ${instruction}`,
              })
            );
          }}
        />
      )}

      {/* Per-slide editing: jump straight to a scoped, surgical edit of one slide. */}
      {(type === "slides" || type === "deck") && record && !streaming && !editing && (() => {
        const unit = type === "deck" ? "card" : "slide";
        const count =
          type === "deck"
            ? (shownBody.match(/<section[^>]*\bclass="[^"]*\bcard\b/gi) || []).length ||
              (shownBody.match(/<section/gi) || []).length
            : (shownBody.match(/<section/gi) || []).length;
        if (count < 1) return null;
        const prefill = (detail: string) =>
          window.dispatchEvent(new CustomEvent("liberde-prefill", { detail }));
        return (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2/50 px-3 py-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Edit {unit}
            </span>
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                title={`Edit ${unit} ${i + 1} (keeps the rest of the deck intact)`}
                onClick={() =>
                  prefill(
                    `In the "${title}" deck (identifier "${record.identifier}"), change ONLY ${unit} ${i + 1} and leave every other ${unit} exactly as-is: `
                  )
                }
                className="min-w-[26px] rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
              >
                {i + 1}
              </button>
            ))}
            {type === "deck" && (
              // Gamma's per-card sparkle menu, as one-line instructions. Each is
              // scoped to a single card so the model edits surgically instead of
              // regenerating a deck the user is happy with.
              <span className="ml-1 flex flex-wrap gap-1">
                {DECK_CARD_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    title={a.title}
                    onClick={() =>
                      prefill(
                        `In the "${title}" deck (identifier "${record.identifier}"), ${a.instruction} Change only that card. Card number: `
                      )
                    }
                    className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
                  >
                    {a.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        );
      })()}

      <div className="flex min-h-0 flex-1 flex-col">
        {editing && record ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {type === "markdown" || type === "html" || type === "svg" ? (
              <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line">
                <CodeEditor
                  value={editValue}
                  onChange={setEditValue}
                  language={language ?? typeToHighlight(type)}
                  className="flex-1"
                />
                <div className="min-h-0 overflow-auto">
                  <ArtifactRenderer type={type} language={language} content={editValue} />
                </div>
              </div>
            ) : (
              <CodeEditor
                value={editValue}
                onChange={setEditValue}
                language={language ?? typeToHighlight(type)}
                className="flex-1"
              />
            )}
            <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1 text-sm text-ink-muted hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await api(`/api/artifacts/${record.id}/versions`, {
                    method: "POST",
                    body: JSON.stringify({ content: editValue }),
                  });
                  setEditing(false);
                  setVersionCursor(null);
                  onVersionSaved?.(record.id);
                }}
                disabled={!editValue.trim()}
                className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Save as new version
              </button>
            </div>
          </div>
        ) : tab === "preview" && canPreview && type ? (
          isVisual ? (
            // Visual artifacts fill the panel edge to edge (responsive, like the
            // popped-out view) and carry the comment/adjust overlays — in any
            // workspace. Non-visual (markdown/code) render bare below.
            <div ref={previewRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
              <ArtifactRenderer
                type={type}
                language={language}
                content={shownBody}
                onRuntimeError={setRuntimeError}
                reloadKey={reloadKey}
                deckTemplate={deckTemplate}
              />

              {commentMode && (
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                  <span className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white shadow-lg">
                    <Icon name="crosshair" size={13} /> Hover to highlight, click an element to tweak just that part
                  </span>
                </div>
              )}

              {showAdjust && (
                <div className="absolute right-4 top-4 max-h-[80%] w-64 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Adjust
                    </span>
                    <button onClick={() => setShowAdjust(false)} className="text-ink-muted hover:text-ink">
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                  {tokens.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      No :root tokens found. Ask for a palette/spacing defined as CSS variables to tune them here.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {tokens.map((t) => {
                        const val = changedTokens[t.name] ?? t.value;
                        const label = t.name.replace(/^--/, "").replace(/-/g, " ");
                        return (
                          <div key={t.name}>
                            <label className="flex items-center justify-between text-[11px] text-ink-muted">
                              <span className="truncate">{label}</span>
                              {lenToken(val) && <span className="tabular-nums">{val}</span>}
                            </label>
                            {isColorToken(val) ? (
                              <div className="mt-0.5 flex items-center gap-2">
                                <input
                                  type="color"
                                  value={/^#([0-9a-f]{6})$/i.test(val.trim()) ? val.trim() : "#888888"}
                                  onChange={(e) => setToken(t.name, e.target.value)}
                                  className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-transparent"
                                />
                                <input
                                  value={val}
                                  onChange={(e) => setToken(t.name, e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                                />
                              </div>
                            ) : lenToken(val) ? (
                              <input
                                type="range"
                                min={0}
                                max={(parseFloat(val) || 0) * 3 + 32}
                                step={val.includes("rem") || val.includes("em") ? 0.1 : 1}
                                value={parseFloat(val) || 0}
                                onChange={(e) =>
                                  setToken(t.name, e.target.value + (val.match(/[a-z%]+$/i)?.[0] ?? ""))
                                }
                                className="mt-1 w-full accent-[var(--color-accent)]"
                              />
                            ) : (
                              <input
                                value={val}
                                onChange={(e) => setToken(t.name, e.target.value)}
                                className="mt-0.5 w-full rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                              />
                            )}
                          </div>
                        );
                      })}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={saveTokenEdits}
                          disabled={Object.keys(changedTokens).length === 0}
                          className="flex-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setChangedTokens({});
                            setReloadKey((k) => k + 1);
                          }}
                          disabled={Object.keys(changedTokens).length === 0}
                          className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ArtifactRenderer
              type={type}
              language={language}
              content={shownBody}
              onRuntimeError={setRuntimeError}
              reloadKey={reloadKey}
            />
          )
        ) : (
          <CodeView content={shownBody} language={language ?? typeToHighlight(type)} />
        )}
      </div>

      {runtimeError && tab === "preview" && !editing && (
        <div className="flex items-center gap-2 border-t border-red-300 bg-red-50 px-3 py-2 text-xs dark:border-red-900 dark:bg-red-950">
          <span className="min-w-0 flex-1 truncate text-red-700 dark:text-red-300" title={runtimeError}>
            ⚠ This artifact threw an error: {runtimeError}
          </span>
          <button
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("liberde-prefill", {
                  detail: `The "${title}" artifact throws this runtime error — please fix it:\n${runtimeError}`,
                })
              );
              setRuntimeError(null);
            }}
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1 font-medium text-white hover:bg-accent-hover"
          >
            Fix with AI
          </button>
          <button
            onClick={() => setRuntimeError(null)}
            className="shrink-0 text-red-700 hover:text-red-900 dark:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {commentTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCommentTarget(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-2xl">
            <p className="text-sm font-medium">Change this element</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{commentTarget}</p>
            <textarea
              autoFocus
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
              }}
              rows={3}
              placeholder="What should change here? e.g. make this bigger and bold, use the accent color"
              className="mt-2 w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setCommentTarget(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={submitComment}
                disabled={!commentText.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Request change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Gamma-style per-card AI actions, shown beside the card-number buttons. */
const DECK_CARD_ACTIONS: { label: string; title: string; instruction: string }[] = [
  {
    label: "New layout",
    title: "Let the model pick a layout that suits the content better",
    instruction:
      "switch one card to a different data-layout that suits its content better, keeping the text.",
  },
  {
    label: "Shorten",
    title: "Cut the words on one card",
    instruction: "cut the text on one card to the essentials — heading under 8 words, bullets under 12.",
  },
  {
    label: "Expand",
    title: "Add substance to one card",
    instruction: "add substance to one card: a concrete number, an example or one more point.",
  },
  {
    label: "Visualise",
    title: "Turn one card into a chart, stats or smart layout",
    instruction:
      "turn one card into a chart, a stats row or a smart layout (timeline, process, pyramid, funnel or cycle).",
  },
  {
    label: "Add image",
    title: "Give one card artwork",
    instruction: "give one card artwork and switch it to an image layout.",
  },
  {
    label: "Duplicate",
    title: "Copy one card and adapt it",
    instruction: "duplicate one card directly after itself and adapt the copy so it is not a repeat.",
  },
  {
    label: "Delete",
    title: "Remove one card",
    instruction: "delete one card entirely.",
  },
];

const CANVAS_ACTIONS: Record<string, { label: string; instruction: string }[]> = {
  markdown: [
    { label: "Shorter", instruction: "make it more concise without losing key points" },
    { label: "Longer", instruction: "expand it with more detail and examples" },
    { label: "More formal", instruction: "rewrite in a more formal, professional tone" },
    { label: "More casual", instruction: "rewrite in a warmer, more casual tone" },
    { label: "Fix grammar", instruction: "fix any grammar, spelling, and punctuation" },
  ],
  code: [
    { label: "Add comments", instruction: "add clear explanatory comments" },
    { label: "Simplify", instruction: "simplify and clean up the code without changing behavior" },
    { label: "Find bugs", instruction: "review for bugs and fix any you find" },
    { label: "Add tests", instruction: "add a small set of tests for the key logic" },
  ],
  html: [
    { label: "Improve design", instruction: "improve the visual design and polish" },
    { label: "Make responsive", instruction: "make the layout fully responsive on mobile" },
    { label: "Add motion", instruction: "add tasteful animations and transitions" },
  ],
  react: [
    { label: "Improve design", instruction: "improve the visual design and polish" },
    { label: "Make responsive", instruction: "make the layout fully responsive on mobile" },
    { label: "Add motion", instruction: "add tasteful animations and transitions" },
  ],
  deck: [
    { label: "Change theme", instruction: "pick a built-in theme that fits this deck better and apply it by changing only data-theme on the deck wrapper" },
    { label: "Tighten copy", instruction: "tighten the copy across every card — fewer words, shorter headings" },
    { label: "More visual", instruction: "convert the text-heaviest cards to image, stats or smart layouts" },
    { label: "Add summary", instruction: "add an executive-summary card straight after the title card" },
  ],
  slides: [
    { label: "Improve design", instruction: "improve the visual design of the deck" },
    { label: "Tighten copy", instruction: "tighten the copy — fewer words per slide" },
    { label: "Add a slide", instruction: "add a strong closing/summary slide" },
  ],
  svg: [
    { label: "Refine", instruction: "refine the shapes and proportions" },
    { label: "Recolor", instruction: "improve the color palette" },
  ],
};

/** ChatGPT-Canvas-style one-click AI transforms scoped to the open artifact. */
/**
 * Reports where an artifact drifts from its design system.
 *
 * Deliberately not a gate. The check is textual and a design system is a
 * guide, so a false positive that blocked a good artifact would be far worse
 * than one that is merely noted — and a clean result is worth showing too,
 * because 'nothing was found' is only reassuring if you can see it was looked
 * for.
 */
function BrandCheck({
  system,
  result,
}: {
  system: string;
  result: { strayColours: string[]; strayFonts: string[]; emojiCount: number };
}) {
  const clean =
    result.strayColours.length === 0 &&
    result.strayFonts.length === 0 &&
    result.emojiCount === 0;

  return (
    <details className="border-b border-line bg-surface-2/50 px-3 py-1.5">
      <summary className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-muted">
        <span
          className={"inline-block h-1.5 w-1.5 shrink-0 rounded-full " + (clean ? "bg-emerald-500" : "bg-amber-500")}
        />
        {clean ? (
          <span>
            On brand — nothing outside <b>{system}</b>
          </span>
        ) : (
          <span>
            {[
              result.strayColours.length
                ? result.strayColours.length + " colour" + (result.strayColours.length === 1 ? "" : "s")
                : "",
              result.strayFonts.length
                ? result.strayFonts.length + " font" + (result.strayFonts.length === 1 ? "" : "s")
                : "",
              result.emojiCount ? result.emojiCount + " emoji" : "",
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            outside <b>{system}</b>
          </span>
        )}
      </summary>

      {clean ? null : (
        <div className="space-y-1.5 pb-1 pt-2 text-[11px] text-ink-muted">
          {result.strayColours.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Not in the palette:</span>
              {result.strayColours.slice(0, 12).map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20"
                    style={{ background: c }}
                  />
                  {c}
                </span>
              ))}
              {result.strayColours.length > 12 ? (
                <span>+{result.strayColours.length - 12} more</span>
              ) : null}
            </div>
          ) : null}

          {result.strayFonts.length > 0 ? (
            <div>Fonts the system does not name: {result.strayFonts.join(", ")}</div>
          ) : null}

          {result.emojiCount > 0 ? (
            <div>
              {result.emojiCount} emoji used where an icon belongs.
            </div>
          ) : null}

          <div className="opacity-70">
            Advisory — the check reads the source, so a colour inside a gradient or a
            webfont loaded at runtime can show up here legitimately.
          </div>
        </div>
      )}
    </details>
  );
}
function CanvasBar({
  type,
  onAction,
}: {
  type: ArtifactType;
  onAction: (instruction: string) => void;
}) {
  const actions = CANVAS_ACTIONS[type];
  if (!actions) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2/50 px-3 py-1.5">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        Canvas
      </span>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => onAction(a.instruction)}
          className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One deck-wrapper attribute, as a compact labelled dropdown. Hovering an
 * option previews it live in the iframe; choosing one commits a new version.
 * The preview is why this is a listbox we draw rather than a <select>: seeing
 * the theme before you keep it is most of the value.
 */
function DeckAttrPicker({
  label,
  icon,
  value,
  options,
  onPreview,
  onCommit,
}: {
  label: string;
  icon: string;
  attr: string;
  value: string;
  options: { id: string; label: string; hint?: string }[];
  onPreview: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const committed = useRef(value);
  useEffect(() => {
    committed.current = value;
  }, [value]);
  const close = (restore: boolean) => {
    if (restore) onPreview(committed.current);
    setOpen(false);
  };
  const current = options.find((o) => o.id === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        // Spelled out rather than "Theme: Aurora", which reads as the app's own
        // light/dark control and is the same words as the sidebar button.
        title={`Change the deck's ${label.toLowerCase()} — currently ${current?.label ?? value}`}
        aria-label={`Deck ${label.toLowerCase()}`}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <Icon name={icon} size={13} />
        <span className="hidden xl:inline">{current?.label ?? value}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => close(true)} />
          <div
            className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
            onMouseLeave={() => onPreview(committed.current)}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-muted">
              {label}
            </div>
            {options.map((o) => (
              <button
                key={o.id}
                onMouseEnter={() => onPreview(o.id)}
                onFocus={() => onPreview(o.id)}
                onClick={() => {
                  committed.current = o.id;
                  onCommit(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                  o.id === value ? "bg-accent/10 text-accent" : "hover:bg-surface-2"
                }`}
              >
                <ThemeSwatch id={o.id} />
                <span className="min-w-0">
                  <span className="block font-medium">{o.label}</span>
                  {o.hint && <span className="block truncate text-ink-muted">{o.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Attention on a published deck. Only appears once the deck has a share link,
 * because before that there is nothing to measure. The per-card bars are the
 * useful part: they say where people stopped reading, which is the one thing a
 * view count cannot tell you.
 */
function DeckAnalyticsChip({ artifactId }: { artifactId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    views: number;
    totalMs: number;
    cards: { card: number; views: number; ms: number }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<typeof data>(`/api/artifacts/${artifactId}/views`)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [open, artifactId]);

  const secs = (ms: number) =>
    ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.max(1, Math.round(ms / 1000))}s`;
  const peak = Math.max(1, ...(data?.cards.map((c) => c.ms) ?? [1]));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Who opened the published link, and which cards held them"
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="barChart" size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-muted">
              Published deck
            </div>
            {error && <p className="text-xs text-ink-muted">Could not load views.</p>}
            {!error && !data && <p className="text-xs text-ink-muted">Loading…</p>}
            {data && data.views === 0 && (
              <p className="text-xs text-ink-muted">
                No one has opened the link yet. Card-by-card attention shows up here once
                they do.
              </p>
            )}
            {data && data.views > 0 && (
              <>
                <div className="mb-2 flex gap-4 text-sm">
                  <span>
                    <b>{data.views}</b>{" "}
                    <span className="text-ink-muted">{data.views === 1 ? "viewer" : "viewers"}</span>
                  </span>
                  <span>
                    <b>{secs(data.totalMs)}</b> <span className="text-ink-muted">total</span>
                  </span>
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {data.cards.map((c) => (
                    <div key={c.card} className="flex items-center gap-2 text-[11px]">
                      <span className="w-5 shrink-0 text-right tabular-nums text-ink-muted">
                        {c.card + 1}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.round((c.ms / peak) * 100)}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 tabular-nums text-ink-muted">
                        {secs(c.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Two-tone chip so a theme is recognisable before you preview it. */
function ThemeSwatch({ id }: { id: string }) {
  const theme = DECK_THEMES.find((t) => t.id === id);
  if (!theme) return null;
  return (
    <span
      aria-hidden
      className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line"
      style={{
        background: `linear-gradient(135deg, ${theme.tokens.accent} 0 50%, ${theme.tokens.accent2} 50% 100%)`,
      }}
    />
  );
}

type PptxSlide = {
  addText: (text: unknown, opts: Record<string, unknown>) => void;
  addNotes: (text: string) => void;
  addImage: (opts: Record<string, unknown>) => void;
  addTable: (rows: unknown, opts: Record<string, unknown>) => void;
  addShape: (shape: unknown, opts: Record<string, unknown>) => void;
  addChart: (type: unknown, data: unknown, opts: Record<string, unknown>) => void;
  background?: { color: string };
};
type PptxDeck = {
  addSlide: () => PptxSlide;
  writeFile: (opts: { fileName: string }) => Promise<void>;
  layout: string;
  defineLayout: (opts: { name: string; width: number; height: number }) => void;
  ChartType: Record<string, unknown>;
  ShapeType: Record<string, unknown>;
};

/**
 * Fetch an image and inline it as a data URI. This has to happen in the host
 * page, not the preview iframe: the iframe runs at an opaque origin (no
 * allow-same-origin), so it cannot read even our own /img/<id> assets.
 * Cross-origin images without CORS simply fail here, and the caller falls back
 * to an on-theme block rather than a broken slide.
 */
async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const PPTX_W = 13.333;
const PPTX_H = 7.5;

/**
 * Deck -> PowerPoint, laid out per card layout rather than dumped as bullets.
 * Gamma's weakest link is this export; ours reads the same layout names the
 * runtime does, so a stats card becomes a row of big numbers and a chart card
 * becomes a native PowerPoint chart you can still edit.
 */
async function exportDeckToPptx(
  deckHtml: string,
  filename: string,
  template?: DeckTemplate | null
) {
  const mod = await importExternal("https://esm.sh/pptxgenjs@3.12.0");
  const PptxGenJS = (mod.default ?? mod) as new () => PptxDeck;
  const doc = new DOMParser().parseFromString(deckHtml, "text/html");
  const wrapper = doc.querySelector(".deck");
  const themeId = wrapper?.getAttribute("data-theme") ?? DEFAULT_DECK_THEME;
  const base = findDeckTheme(themeId);
  // On a template, PowerPoint gets the user's own brand. Its colours may be
  // gradients or rgba, neither of which PowerPoint takes, so they collapse to
  // their first hex; the built-in theme fills any gap.
  const onTemplate = themeId === "custom" && template;
  const palette = onTemplate ? templatePptxPalette(template, base.pptx) : base.pptx;
  const theme = {
    ...base,
    pptx: palette,
    fonts: onTemplate
      ? {
          ...base.fonts,
          heading: template.tokens["heading-font"] || base.fonts.heading,
          body: template.tokens["body-font"] || base.fonts.body,
        }
      : base.fonts,
  };
  const cards = Array.from(doc.querySelectorAll("section.card, .card")).filter(
    (c) => !c.hasAttribute("data-nested")
  );
  const sections = cards.length ? cards : Array.from(doc.body.children);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LD_WIDE", width: PPTX_W, height: PPTX_H });
  pptx.layout = "LD_WIDE";

  const headFace = theme.fonts.heading.split(",")[0];
  const bodyFace = theme.fonts.body.split(",")[0];
  const ink = theme.pptx.ink;
  const accent = theme.pptx.accent;
  const text = (el: Element | null) => (el?.textContent || "").trim();
  const notIn = (el: Element) => !el.closest("aside.notes, .notes");

  for (const section of sections) {
    if (section.tagName === "STYLE" || section.tagName === "SCRIPT") continue;
    const layout = section.getAttribute("data-layout") || "text";
    const slide = pptx.addSlide();
    slide.background = { color: theme.pptx.surface };

    const notes = section.querySelector("aside.notes, .notes");
    if (notes && text(notes)) {
      try {
        slide.addNotes(text(notes));
      } catch {
        /* older pptxgenjs — skip notes rather than fail the export */
      }
    }

    const heading = section.querySelector("h1, h2");
    const kicker = section.querySelector(".kicker");
    const lede = section.querySelector(".lede");
    const figures = Array.from(section.querySelectorAll("figure")).filter(notIn);
    const big = layout === "title" || layout === "closing" || layout === "section";

    // Picture-first layouts get the image placed, then the text beside it.
    let textX = 0.7;
    let textW = PPTX_W - 1.4;
    const imgSide = layout === "image-right" || layout === "image-left";
    if (imgSide || layout === "image-bg" || layout === "studio" || layout === "image-top") {
      const fig = figures[0];
      const src = fig?.querySelector("img")?.getAttribute("src");
      const data = src ? await imageToDataUri(src) : null;
      const box =
        layout === "image-bg" || layout === "studio"
          ? { x: 0, y: 0, w: PPTX_W, h: PPTX_H }
          : layout === "image-top"
            ? { x: 0, y: 0, w: PPTX_W, h: 3.1 }
            : layout === "image-right"
              ? { x: PPTX_W / 2, y: 0, w: PPTX_W / 2, h: PPTX_H }
              : { x: 0, y: 0, w: PPTX_W / 2, h: PPTX_H };
      if (data) {
        slide.addImage({ data, ...box, sizing: { type: "cover", w: box.w, h: box.h } });
      } else {
        slide.addShape(pptx.ShapeType.rect, { ...box, fill: { color: accent, transparency: 80 } });
      }
      if (layout === "image-right") {
        textX = 0.7;
        textW = PPTX_W / 2 - 1.2;
      } else if (layout === "image-left") {
        textX = PPTX_W / 2 + 0.5;
        textW = PPTX_W / 2 - 1.2;
      }
    }
    if (layout === "studio") continue; // the image is the whole card

    const dark = layout === "image-bg" || theme.dark;
    const fg = dark && layout === "image-bg" ? "FFFFFF" : ink;
    let y = big ? 2.4 : 0.6;

    if (kicker && text(kicker)) {
      slide.addText(text(kicker).toUpperCase(), {
        x: textX, y: y, w: textW, h: 0.35,
        fontSize: 12, bold: true, charSpacing: 2,
        color: layout === "image-bg" ? "FFFFFF" : accent, fontFace: headFace,
      });
      y += 0.45;
    }
    if (heading && text(heading)) {
      const size = big ? 40 : 28;
      slide.addText(text(heading), {
        x: textX, y, w: textW, h: big ? 1.5 : 1.0,
        fontSize: size, bold: true, color: fg, fontFace: headFace,
        align: big ? "center" : "left",
      });
      y += big ? 1.6 : 1.1;
    }
    if (lede && text(lede)) {
      slide.addText(text(lede), {
        x: textX, y, w: textW, h: 0.8, fontSize: big ? 18 : 15,
        color: fg, fontFace: bodyFace, align: big ? "center" : "left",
      });
      y += 0.95;
    }

    if (layout === "stats") {
      const stats = Array.from(section.querySelectorAll(".stat")).filter(notIn);
      const w = stats.length ? (PPTX_W - 1.4) / stats.length : PPTX_W;
      stats.forEach((st, idx) => {
        slide.addText(text(st.querySelector("b")), {
          x: 0.7 + w * idx, y: y + 0.3, w, h: 1.3,
          fontSize: 44, bold: true, color: accent, fontFace: headFace,
        });
        slide.addText(text(st.querySelector("span")), {
          x: 0.7 + w * idx, y: y + 1.6, w, h: 0.7,
          fontSize: 13, color: ink, fontFace: bodyFace,
        });
      });
      continue;
    }

    if (layout === "quote") {
      const q = section.querySelector("blockquote p");
      const cite = section.querySelector("cite");
      slide.addText(text(q), {
        x: 1.4, y: 2.2, w: PPTX_W - 2.8, h: 2.4,
        fontSize: 28, italic: true, color: ink, fontFace: headFace, align: "center",
      });
      slide.addText(text(cite), {
        x: 1.4, y: 4.8, w: PPTX_W - 2.8, h: 0.5,
        fontSize: 13, color: accent, fontFace: bodyFace, align: "center",
      });
      continue;
    }

    const chartTable = section.querySelector("table[data-chart]");
    if (chartTable) {
      const kind = (chartTable.getAttribute("data-chart") || "bar").toLowerCase();
      const heads = Array.from(chartTable.querySelectorAll("thead th")).map((th) => text(th));
      const rows = Array.from(chartTable.querySelectorAll("tbody tr"));
      const labels = rows.map((r) => text(r.children[0]));
      const seriesCount = Math.max(1, heads.length - 1);
      const data = [];
      for (let s = 0; s < seriesCount; s++) {
        data.push({
          name: heads[s + 1] || `Series ${s + 1}`,
          labels,
          values: rows.map((r) => {
            const cell = r.children[s + 1];
            return Number((text(cell) || "0").replace(/[^0-9.-]/g, "")) || 0;
          }),
        });
      }
      const map: Record<string, string> = {
        bar: "bar", column: "bar", stacked: "bar", hbar: "bar",
        line: "line", area: "area", pie: "pie", donut: "doughnut",
        scatter: "scatter", radar: "radar", gauge: "doughnut", waterfall: "bar",
      };
      try {
        slide.addChart(pptx.ChartType[map[kind] || "bar"], data, {
          x: 0.8, y: y + 0.2, w: PPTX_W - 1.6, h: PPTX_H - y - 0.8,
          showLegend: seriesCount > 1, legendPos: "b",
          chartColors: [accent, theme.pptx.ink],
          barDir: kind === "hbar" ? "bar" : "col",
          barGrouping: kind === "stacked" ? "stacked" : "clustered",
        });
      } catch {
        /* chart unsupported by this pptxgenjs build — fall through to the table */
      }
      continue;
    }

    const table = Array.from(section.querySelectorAll("table")).filter(notIn)[0];
    if (table) {
      const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.children).map((td) => ({
          text: text(td),
          options: {
            bold: td.tagName === "TH",
            color: td.tagName === "TH" ? accent : ink,
            fontFace: bodyFace,
          },
        }))
      );
      slide.addTable(rows, {
        x: 0.7, y: y + 0.2, w: PPTX_W - 1.4,
        fontSize: 12, border: { type: "solid", pt: 0.5, color: "DDDDDD" },
      });
      continue;
    }

    const cols = Array.from(section.querySelectorAll(".col")).filter(notIn);
    const steps = Array.from(section.querySelectorAll(".steps > li")).filter(notIn);
    const units = cols.length ? cols : steps;
    if (units.length) {
      const w = (PPTX_W - 1.4) / units.length;
      units.forEach((u, idx) => {
        const t = text(u.querySelector("h3, b")) || text(u).slice(0, 40);
        const d = text(u.querySelector("p, span"));
        if (steps.length) {
          slide.addShape(pptx.ShapeType.ellipse, {
            x: 0.7 + w * idx, y: y + 0.2, w: 0.5, h: 0.5,
            fill: { color: accent },
          });
          slide.addText(String(idx + 1), {
            x: 0.7 + w * idx, y: y + 0.2, w: 0.5, h: 0.5,
            fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle",
          });
        }
        slide.addText(t, {
          x: 0.7 + w * idx, y: y + (steps.length ? 0.85 : 0.2), w: w - 0.25, h: 0.6,
          fontSize: 16, bold: true, color: ink, fontFace: headFace,
        });
        slide.addText(d, {
          x: 0.7 + w * idx, y: y + (steps.length ? 1.45 : 0.8), w: w - 0.25, h: 2,
          fontSize: 12, color: ink, fontFace: bodyFace,
        });
      });
      continue;
    }

    const bullets = Array.from(section.querySelectorAll("li"))
      .filter(notIn)
      .map((li) => text(li))
      .filter(Boolean);
    const paras = Array.from(section.querySelectorAll("p"))
      .filter(notIn)
      .filter((p) => !p.classList.contains("kicker") && !p.classList.contains("lede"))
      .map((p) => text(p))
      .filter(Boolean);
    const bodyRuns = [
      ...paras.map((t) => ({ text: t, options: { bullet: false, breakLine: true } })),
      ...bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
    ];
    if (bodyRuns.length) {
      slide.addText(bodyRuns, {
        x: textX, y: y + 0.1, w: textW, h: PPTX_H - y - 0.7,
        fontSize: 15, color: fg, fontFace: bodyFace,
      });
    }
  }

  await pptx.writeFile({ fileName: `${filename.replace(/[^\w-]/g, "") || "deck"}.pptx` });
}

/**
 * Every card as a PNG, zipped. Rendering happens in a hidden same-origin iframe
 * (the deck markup here is the one we just built, and html-to-image needs to
 * read computed styles), then each card is captured at 2x.
 */
async function exportDeckToPngZip(
  deckHtml: string,
  filename: string,
  template?: DeckTemplate | null
) {
  const [h2i, fflate] = await Promise.all([
    importExternal("https://esm.sh/html-to-image@1.11.11"),
    importExternal("https://esm.sh/fflate@0.8.2"),
  ]);
  const toPng = (h2i as unknown as { toPng: (n: HTMLElement, o?: object) => Promise<string> })
    .toPng;
  const zipSync = (
    fflate as unknown as { zipSync: (f: Record<string, Uint8Array>) => Uint8Array }
  ).zipSync;

  const host = document.createElement("iframe");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:1280px;height:900px;border:0";
  document.body.appendChild(host);
  try {
    const idoc = host.contentDocument!;
    idoc.open();
    idoc.write(buildSrcDoc("deck", deckHtml, { template }) ?? deckHtml);
    idoc.close();
    await new Promise((r) => setTimeout(r, 1200)); // fonts + runtime
    const cards = Array.from(idoc.querySelectorAll(".deck > .card")) as HTMLElement[];
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < cards.length; i++) {
      const url = await toPng(cards[i], { pixelRatio: 2, cacheBust: true });
      const bin = atob(url.split(",")[1]);
      const bytes = new Uint8Array(bin.length);
      for (let b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
      files[`card-${String(i + 1).padStart(2, "0")}.png`] = bytes;
    }
    if (!Object.keys(files).length) throw new Error("no cards found");
    const zipped = zipSync(files);
    const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename.replace(/[^\w-]/g, "") || "deck"}-cards.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } finally {
    host.remove();
  }
}

/** Best-effort .pptx export: extracts headings/bullets/paragraphs per slide via pptxgenjs. */
async function exportSlidesToPptx(deckHtml: string, filename: string) {
  const mod = await importExternal("https://esm.sh/pptxgenjs@3.12.0");
  const PptxGenJS = (mod.default ?? mod) as new () => {
    addSlide: () => {
      addText: (text: unknown, opts: Record<string, unknown>) => void;
      addNotes: (text: string) => void;
    };
    writeFile: (opts: { fileName: string }) => Promise<void>;
  };
  const doc = new DOMParser().parseFromString(deckHtml, "text/html");
  let sections = Array.from(doc.querySelectorAll("section.slide, .slide"));
  if (sections.length === 0) sections = Array.from(doc.body.children) as Element[];
  const pptx = new PptxGenJS();
  for (const section of sections) {
    if (section.tagName === "STYLE" || section.tagName === "SCRIPT") continue;
    const slide = pptx.addSlide();
    // Speaker notes export as real PowerPoint presenter notes — never as
    // slide body content.
    const notes = section.querySelector("aside.notes, .notes");
    if (notes?.textContent?.trim()) {
      try {
        slide.addNotes(notes.textContent.trim());
      } catch {
        /* older pptxgenjs — skip notes rather than fail the export */
      }
    }
    const inNotes = (el: Element) => Boolean(el.closest("aside.notes, .notes"));
    const heading = section.querySelector("h1, h2, h3");
    if (heading?.textContent?.trim()) {
      slide.addText(heading.textContent.trim(), {
        x: 0.5, y: 0.4, w: 9, h: 1.1, fontSize: 30, bold: true,
      });
    }
    const bullets = Array.from(section.querySelectorAll("li"))
      .filter((li) => !inNotes(li))
      .map((li) => li.textContent?.trim())
      .filter(Boolean) as string[];
    const paragraphs = Array.from(section.querySelectorAll("p"))
      .filter((p) => !inNotes(p))
      .map((p) => p.textContent?.trim())
      .filter((t) => t && t !== heading?.textContent?.trim()) as string[];
    const body = [
      ...paragraphs.map((t) => ({ text: t, options: { bullet: false, breakLine: true } })),
      ...bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
    ];
    if (body.length) {
      slide.addText(body, { x: 0.6, y: 1.7, w: 8.8, h: 3.6, fontSize: 16 });
    }
  }
  await pptx.writeFile({ fileName: `${filename.replace(/[^\w-]/g, "")}.pptx` });
}

/** Word-openable .doc: markdown → HTML (marked) wrapped in Word-compatible markup. */
async function exportMarkdownToDoc(markdown: string, filename: string) {
  const mod = await importExternal("https://esm.sh/marked@12.0.2");
  const marked = (mod.marked ?? mod.default) as { parse: (s: string) => string };
  const html = marked.parse(markdown);
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><style>body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.5}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4pt 8pt}</style></head>
<body>${html}</body></html>`;
  const blob = new Blob(["﻿", doc], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/[^\w-]/g, "")}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/\r/g, "").trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function parseMarkdownTable(md: string): string[][] {
  const rows: string[][] = [];
  for (const l of md.split(/\r?\n/)) {
    if (!l.includes("|")) continue;
    if (/^\s*\|?\s*:?-{2,}/.test(l)) continue; // header separator row
    const cells = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  return rows;
}

/** Export tabular content (CSV/TSV artifact or markdown tables) to a real .xlsx. */
async function exportToXlsx(
  content: string,
  language: string | null,
  filename: string
) {
  const lang = (language || "").toLowerCase();
  let rows: string[][] =
    lang === "tsv"
      ? content.trim().split(/\r?\n/).map((l) => l.split("\t"))
      : lang === "csv"
        ? parseCsv(content)
        : parseMarkdownTable(content);
  if (rows.length === 0) rows = parseCsv(content);
  if (rows.length === 0) throw new Error("No tabular data found to export");
  const mod = await importExternal("https://esm.sh/xlsx@0.18.5");
  const XLSX = (mod.default ?? mod) as {
    utils: {
      aoa_to_sheet: (rows: string[][]) => unknown;
      book_new: () => unknown;
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    };
    writeFile: (wb: unknown, name: string) => void;
  };
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename.replace(/[^\w-]/g, "")}.xlsx`);
}

function typeToHighlight(type: ArtifactType | null): string | null {
  switch (type) {
    case "html":
      return "html";
    case "svg":
      return "xml";
    case "react":
      return "tsx";
    case "markdown":
      return "markdown";
    default:
      return null;
  }
}

function ShareMenu({
  record,
  shownVersion,
  onUpdated,
  onClose,
}: {
  record: ArtifactRecord;
  shownVersion: number;
  onUpdated: (r: ArtifactRecord) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [recipients, setRecipients] = useState<
    { user_id: string; email: string; name: string }[]
  >([]);
  const [sendEmail, setSendEmail] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const shareUrl = record.share_id
    ? `${window.location.origin}/a/${record.share_id}`
    : null;

  useEffect(() => {
    api<{ user_id: string; email: string; name: string }[]>(
      `/api/artifacts/${record.id}/share`
    )
      .then(setRecipients)
      .catch(() => {});
  }, [record.id]);

  const sendToUser = async () => {
    if (!sendEmail.trim()) return;
    setSendBusy(true);
    setSendError(null);
    try {
      setRecipients(
        await api<{ user_id: string; email: string; name: string }[]>(
          `/api/artifacts/${record.id}/share`,
          { method: "POST", body: JSON.stringify({ email: sendEmail }) }
        )
      );
      setSendEmail("");
    } catch (e) {
      setSendError(String((e as Error).message || e));
    } finally {
      setSendBusy(false);
    }
  };

  const removeRecipient = async (userId: string) => {
    setRecipients(
      await api<{ user_id: string; email: string; name: string }[]>(
        `/api/artifacts/${record.id}/share`,
        { method: "DELETE", body: JSON.stringify({ userId }) }
      ).catch(() => recipients)
    );
  };

  const publish = async (mode: "latest" | "pinned") => {
    setBusy(true);
    try {
      const updated = await api<ArtifactRecord>(`/api/artifacts/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({ publish: true, mode, version: shownVersion }),
      });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    try {
      const updated = await api<ArtifactRecord>(`/api/artifacts/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({ publish: false }),
      });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  // Escape closes the share menu, for the same reason as the model menu: its
  // backdrop spans the window, and an overlay that ignores Escape leaves the
  // app looking alive and behaving as though it is not.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-line bg-surface p-3 text-sm shadow-xl">
        {shareUrl ? (
          <>
            <p className="mb-1 font-medium">
              Published —{" "}
              {record.share_mode === "latest"
                ? "always shows the latest version"
                : `pinned to v${record.pinned_version}`}
            </p>
            <div className="mb-2 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={() => navigator.clipboard.writeText(shareUrl)}
                className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover"
              >
                Copy
              </button>
            </div>
          </>
        ) : (
          <p className="mb-2 text-ink-muted">
            Publishing creates a public link anyone can open. The link stays the same as
            you republish.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <button
            disabled={busy}
            onClick={() => publish("latest")}
            className="rounded-lg border border-line px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
          >
            {record.share_mode === "latest" ? "✓ " : ""}Share latest version
            <span className="block text-xs text-ink-muted">
              Viewers always see your newest version
            </span>
          </button>
          <button
            disabled={busy}
            onClick={() => publish("pinned")}
            className="rounded-lg border border-line px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
          >
            {record.share_mode === "pinned" && record.pinned_version === shownVersion
              ? "✓ "
              : ""}
            Pin v{shownVersion}
            <span className="block text-xs text-ink-muted">
              Viewers see exactly this version
            </span>
          </button>
          {shareUrl && (
            <button
              disabled={busy}
              onClick={unpublish}
              className="rounded-lg border border-line px-2 py-1.5 text-left text-red-500 hover:bg-surface-2 disabled:opacity-50"
            >
              Unpublish
              <span className="block text-xs text-ink-muted">The link stops working</span>
            </button>
          )}
        </div>

        {/* User-to-user: the recipient gets it in "Shared with you" and opens
            their own editable copy — no public link involved. */}
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="font-medium">Send to a Liberde user</p>
          <p className="mb-1.5 text-xs text-ink-muted">
            They&apos;ll get it under “Shared with you” and can edit their own copy.
          </p>
          {recipients.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {recipients.map((r) => (
                <span
                  key={r.user_id}
                  className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
                >
                  {r.name || r.email}
                  <button
                    onClick={() => removeRecipient(r.user_id)}
                    className="text-ink-muted hover:text-ink"
                    aria-label={`Stop sharing with ${r.email}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendToUser()}
              placeholder="teammate@email.com"
              className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
            />
            <button
              disabled={!sendEmail.trim() || sendBusy}
              onClick={sendToUser}
              className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {sendBusy ? "Sending…" : "Send"}
            </button>
          </div>
          {sendError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{sendError}</p>
          )}
        </div>
      </div>
    </>
  );
}
