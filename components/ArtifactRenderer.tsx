"use client";

import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import Markdown from "./Markdown";
import type { ArtifactType } from "@/lib/artifact-shared";
import { buildSrcDoc } from "@/lib/artifact-srcdoc";

export { buildSrcDoc };


// Cheap stable hash so the iframe key changes only when the rendered content does.
function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export default function ArtifactRenderer({
  type,
  language,
  content,
  onRuntimeError,
  reloadKey = 0,
}: {
  type: ArtifactType;
  language: string | null;
  content: string;
  onRuntimeError?: (message: string) => void;
  /** Bump to force the preview iframe to fully remount and re-run its scripts. */
  reloadKey?: number;
}) {
  const srcDoc = useMemo(
    () => buildSrcDoc(type, content),
    [type, content]
  );

  // Capture runtime errors the sandboxed preview reports (Claude's "Fix with AI" path).
  useEffect(() => {
    if (!onRuntimeError) return;
    const onMessage = (e: MessageEvent) => {
      const err = (e.data as { __liberdeArtifactError?: string })?.__liberdeArtifactError;
      if (typeof err === "string" && err) onRuntimeError(err);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onRuntimeError, content]);

  if (srcDoc != null) {
    return (
      <iframe
        // Remount on content/type/reload change so CDN scripts re-run reliably
        // (browsers don't always re-execute scripts on a bare srcDoc swap).
        key={`${type}:${hashContent(srcDoc)}:${reloadKey}`}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        srcDoc={srcDoc}
        className="h-full w-full flex-1 border-0 bg-white"
        title="Artifact preview"
      />
    );
  }

  if (type === "markdown") {
    return (
      <div className="h-full w-full overflow-auto bg-surface p-6">
        <Markdown content={content} onShowArtifact={() => {}} />
      </div>
    );
  }

  return <CodeView content={content} language={language} />;
}

/**
 * A syntax-highlighted code editor: a highlighted <pre> layer sits behind a
 * transparent-text <textarea>, so you type into a real, editable field that
 * looks color-coded (highlight.js + the app's github-dark theme). Both layers
 * share identical typography/padding/wrapping so the caret stays aligned.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string | null;
  className?: string;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    try {
      const result =
        language && hljs.getLanguage(language)
          ? hljs.highlight(value, { language })
          : hljs.highlightAuto(value);
      // Trailing newline keeps the highlighted layer's height in lockstep with
      // the textarea when the content ends without one.
      el.innerHTML = result.value + "\n";
    } catch {
      el.textContent = value + "\n";
    }
  }, [value, language]);

  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      onChange(value.slice(0, s) + "  " + value.slice(en));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  };

  // Identical box model on both layers so the highlight sits exactly under the text.
  const shared =
    "m-0 border-0 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words";

  return (
    <div className={`hljs relative min-h-0 overflow-hidden ${className ?? ""}`}>
      <pre
        ref={preRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden ${shared}`}
        style={{ background: "transparent" }}
      >
        <code ref={codeRef} />
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        className={`absolute inset-0 resize-none overflow-auto bg-transparent text-transparent caret-white outline-none ${shared}`}
      />
    </div>
  );
}

export function CodeView({
  content,
  language,
}: {
  content: string;
  language: string | null;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const result =
        language && hljs.getLanguage(language)
          ? hljs.highlight(content, { language })
          : hljs.highlightAuto(content);
      el.innerHTML = result.value;
    } catch {
      el.textContent = content;
    }
  }, [content, language]);

  return (
    <pre className="hljs h-full w-full flex-1 overflow-auto p-4 text-xs leading-relaxed">
      <code ref={ref} />
    </pre>
  );
}
