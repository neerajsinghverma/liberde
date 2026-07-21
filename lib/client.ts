import type { Attachment } from "./types";

export async function api<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolEvent?: (status: string) => void;
  onDone: (
    messageId: string | null,
    title: string | null,
    memoriesSaved?: number,
    /** true when the stream ended by user abort or unexpected close, not a clean finish */
    aborted?: boolean
  ) => void;
  onError: (message: string) => void;
}

/** POST /api/chat and consume the SSE stream. Returns an abort function. */
export function streamChat(
  body: {
    conversationId: string;
    content?: string;
    attachments?: Attachment[];
    truncateFromMessageId?: string;
    model?: string;
    webSearch?: boolean;
    think?: boolean;
    designImages?: boolean;
    imageModel?: string;
  },
  callbacks: StreamCallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    let sawDone = false;
    let sawError = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        callbacks.onError(err.error || `Chat request failed (${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.delta) callbacks.onDelta(evt.delta);
            if (evt.reasoning) callbacks.onReasoning?.(evt.reasoning);
            if (evt.toolEvent?.status) callbacks.onToolEvent?.(evt.toolEvent.status);
            if (evt.error) {
              sawError = true;
              callbacks.onError(evt.error);
            }
            if (evt.done) {
              sawDone = true;
              callbacks.onDone(
                evt.messageId ?? null,
                evt.title ?? null,
                evt.memoriesSaved ?? 0,
                false
              );
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
      // Stream closed without a done event: treat as aborted/failed — never as
      // a clean finish (a clean finish always carries `done`).
      if (!sawDone && !sawError) callbacks.onDone(null, null, 0, true);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        callbacks.onDone(null, null, 0, true);
      } else if (!sawError) {
        callbacks.onError(String(e));
      }
    }
  })();

  return () => controller.abort();
}

/** POST /api/research and consume the SSE stream (statuses + report deltas). */
export function streamResearch(
  body: { conversationId: string; query: string; model?: string },
  callbacks: StreamCallbacks & { onStatus: (status: string) => void }
): () => void {
  return streamPipeline("/api/research", body, callbacks);
}

/** POST /api/agent (plan → execute → deliverable) and consume the SSE stream. */
export function streamAgent(
  body: { conversationId: string; goal: string; model?: string },
  callbacks: StreamCallbacks & { onStatus: (status: string) => void }
): () => void {
  return streamPipeline("/api/agent", body, callbacks);
}

function streamPipeline(
  url: string,
  body: unknown,
  callbacks: StreamCallbacks & { onStatus: (status: string) => void }
): () => void {
  const controller = new AbortController();
  const conversationId = (body as { conversationId?: string }).conversationId;

  (async () => {
    let sawDone = false;
    let sawError = false;
    // A durable agent run may span several serverless invocations: when the
    // server pauses at its wall-clock budget it emits { paused, runId }, and we
    // transparently re-invoke to continue the same run until it finishes.
    let nextBody: unknown = body;
    try {
      while (nextBody && !controller.signal.aborted) {
        let resumeRunId: string | null = null;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextBody),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          callbacks.onError(err.error || `Request failed (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.status) callbacks.onStatus(evt.status);
              if (evt.delta) callbacks.onDelta(evt.delta);
              if (evt.paused && evt.runId) resumeRunId = evt.runId;
              if (evt.error) {
                sawError = true;
                callbacks.onError(evt.error);
              }
              if (evt.done) {
                sawDone = true;
                callbacks.onDone(evt.messageId ?? null, null, 0, false);
              }
            } catch {
              /* skip malformed line */
            }
          }
        }
        if (resumeRunId && !sawError && !sawDone && conversationId) {
          nextBody = { conversationId, resumeRunId };
          continue; // resume the next slice of this run
        }
        break;
      }
      if (!sawDone && !sawError) callbacks.onDone(null, null, 0, true);
    } catch (e) {
      if ((e as Error).name === "AbortError") callbacks.onDone(null, null, 0, true);
      else if (!sawError) callbacks.onError(String(e));
    }
  })();

  return () => controller.abort();
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Downscale large images the way Claude does (max edge ~1568px) so requests stay small. */
async function imageToDataUrl(file: File): Promise<string> {
  const MAX_EDGE = 1568;
  const original = await readAsDataUrl(file);
  if (file.size < 400_000) return original; // small enough as-is
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = original;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1_500_000) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    // JPEG for photos; keep PNG when transparency might matter.
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    return canvas.toDataURL(mime, 0.85);
  } catch {
    return original;
  }
}

export async function fileToUploadAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) {
    return { name: file.name, mime: file.type, dataUrl: await imageToDataUrl(file) };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return {
      name: file.name,
      mime: "application/pdf",
      dataUrl: await readAsDataUrl(file),
    };
  }
  const text = await file.text();
  return { name: file.name, mime: file.type || "text/plain", text };
}
