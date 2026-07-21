"use client";

import { useState } from "react";
import type { ArtifactType } from "@/lib/artifact-shared";
import ArtifactRenderer, { CodeView } from "./ArtifactRenderer";
import { typeIcon } from "./ArtifactPanel";
import { api } from "@/lib/client";

export default function SharedArtifact({
  shareId,
  title,
  type,
  language,
  content,
  version,
  isLatest,
}: {
  shareId: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  content: string;
  version: number;
  isLatest: boolean;
}) {
  const renderable = ["html", "react", "svg", "mermaid", "markdown", "slides"].includes(type);
  const [tab, setTab] = useState<"preview" | "code">(renderable ? "preview" : "code");
  const [remixing, setRemixing] = useState(false);

  const remix = async () => {
    setRemixing(true);
    try {
      const { conversationId } = await api<{ conversationId: string }>(
        `/api/remix/${shareId}`,
        { method: "POST" }
      );
      window.location.href = `/c/${conversationId}`;
    } catch {
      setRemixing(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <span className="text-lg">{typeIcon(type)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="text-xs text-ink-muted">
            v{version}
            {isLatest ? " (latest)" : ""} · published with{" "}
            <a href="/" className="text-accent hover:underline">
              Liberde
            </a>
          </p>
        </div>
        {renderable && (
          <div className="flex rounded-lg border border-line text-xs">
            <button
              onClick={() => setTab("preview")}
              className={`rounded-l-lg px-2.5 py-1.5 ${tab === "preview" ? "bg-surface-2 font-medium" : "text-ink-muted"}`}
            >
              Preview
            </button>
            <button
              onClick={() => setTab("code")}
              className={`rounded-r-lg px-2.5 py-1.5 ${tab === "code" ? "bg-surface-2 font-medium" : "text-ink-muted"}`}
            >
              Code
            </button>
          </div>
        )}
        <button
          onClick={remix}
          disabled={remixing}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {remixing ? "Remixing…" : "⑂ Remix"}
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "preview" && renderable ? (
          <ArtifactRenderer type={type} language={language} content={content} />
        ) : (
          <CodeView content={content} language={language} />
        )}
      </main>
    </div>
  );
}
