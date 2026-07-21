"use client";

import Markdown from "./Markdown";
import { splitContentSegments } from "@/lib/artifact-shared";
import { typeIcon } from "./ArtifactPanel";
import { CodeView } from "./ArtifactRenderer";
import { useState } from "react";

interface SnapshotMessage {
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  images?: string[] | null;
  created_at: number;
}

export default function SharedChatView({
  title,
  createdAt,
  messages,
}: {
  title: string;
  createdAt: number;
  messages: SnapshotMessage[];
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 border-b border-line bg-surface px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-lg font-semibold">{title}</h1>
          <p className="text-xs text-ink-muted">
            Shared {new Date(createdAt).toLocaleDateString()} · read-only snapshot ·{" "}
            <a href="/" className="text-accent hover:underline">
              made with Liberde
            </a>
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="mb-6 flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="mb-6">
              <SnapshotAssistant content={msg.content} />
              {msg.images?.map((src, j) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={j}
                  src={src}
                  alt="Generated"
                  className="mt-2 max-w-full rounded-xl border border-line"
                />
              ))}
              {msg.model && (
                <p className="mt-1 text-xs text-ink-muted">{msg.model}</p>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}

function SnapshotAssistant({ content }: { content: string }) {
  const segments = splitContentSegments(content);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text" && seg.text?.trim()) {
          return <Markdown key={i} content={seg.text} onShowArtifact={() => {}} />;
        }
        if (seg.kind === "artifact" && seg.block && seg.block.content) {
          return (
            <SnapshotArtifact
              key={i}
              title={seg.block.title ?? seg.block.identifier}
              type={seg.block.type ?? "code"}
              language={seg.block.language}
              content={seg.block.content}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function SnapshotArtifact({
  title,
  type,
  language,
  content,
}: {
  title: string;
  type: string;
  language: string | null;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left text-sm"
      >
        <span>{typeIcon(type)}</span>
        <span className="flex-1 truncate font-medium">{title}</span>
        <span className="text-xs text-ink-muted">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="max-h-96 overflow-auto">
          <CodeView content={content} language={language} />
        </div>
      )}
    </div>
  );
}
