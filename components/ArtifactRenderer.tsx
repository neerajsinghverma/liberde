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
