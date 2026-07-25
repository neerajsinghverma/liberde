"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactRecord, ArtifactType, ArtifactVersion } from "@/lib/artifact-shared";
import { api } from "@/lib/client";
import { toast } from "@/lib/ui";
import ArtifactRenderer, { CodeView, CodeEditor } from "./ArtifactRenderer";
import { buildSrcDoc } from "@/lib/artifact-srcdoc";
import Icon from "./Icon";

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

const TYPE_ICONS: Record<string, string> = {
  html: "🌐",
  react: "⚛",
  svg: "✒",
  mermaid: "📊",
  markdown: "📝",
  code: "📄",
  slides: "📽",
};

export function typeIcon(type: string | null) {
  return TYPE_ICONS[type ?? "code"] ?? "📄";
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
}

export default function ArtifactPanel({
  content,
  onClose,
  onRecordUpdated,
  onVersionSaved,
}: {
  content: PanelContent;
  onClose: () => void;
  onRecordUpdated: (record: ArtifactRecord) => void;
  onVersionSaved?: (artifactId: string) => void;
  /** Kept for compatibility with ChatView's prop pass; design tools now gate on
   *  the artifact type (isVisual), not the workspace. */
  designCanvas?: boolean;
}) {
  const isRenderable = (t: ArtifactType | null) =>
    t === "html" ||
    t === "react" ||
    t === "svg" ||
    t === "mermaid" ||
    t === "markdown" ||
    t === "slides";

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

  // While streaming, show raw code (a half-written page re-rendering constantly is noise);
  // flip to preview when the artifact completes or a different artifact opens.
  useEffect(() => {
    if (streaming) setTab("code");
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

  const canPreview = isRenderable(type) && !streaming;
  // "Visual" artifacts have a rendered canvas you can point at and restyle
  // (elements to click, CSS tokens to tweak) — so the design tools (Adjust,
  // Comment-to-edit) apply to them in ANY workspace, not just Design mode.
  // Markdown/mermaid/code render but have nothing to design-edit.
  const isVisual =
    type === "html" || type === "react" || type === "svg" || type === "slides";
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
    if (type !== "slides") return;
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
      className="relative flex w-[46%] min-w-[380px] shrink-0 flex-col border-l border-line bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-full max-lg:min-w-0"
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
        <span className="text-base max-lg:hidden">{typeIcon(type)}</span>
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
            title={type === "slides" ? "Present full screen (print for PDF)" : "Open full screen"}
            onClick={() => {
              const doc = buildSrcDoc(type!, shownBody);
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
              type === "react" ? "tsx" : type === "markdown" ? "md" : type === "mermaid" ? "mmd" : type === "svg" ? "svg" : type === "html" || type === "slides" ? "html" : language || "txt";
            // Slides download as a self-contained playable deck, not raw sections.
            const data =
              type === "slides" ? (buildSrcDoc("slides", shownBody) ?? shownBody) : shownBody;
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
      {type === "slides" && record && !streaming && !editing && (() => {
        const count = (shownBody.match(/<section/gi) || []).length;
        if (count < 1) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2/50 px-3 py-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Edit slide
            </span>
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                title={`Edit slide ${i + 1} (keeps the rest of the deck intact)`}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("liberde-prefill", {
                      detail: `In the "${title}" deck (identifier "${record.identifier}"), change ONLY slide ${i + 1} and leave every other slide exactly as-is: `,
                    })
                  )
                }
                className="min-w-[26px] rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
              >
                {i + 1}
              </button>
            ))}
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
