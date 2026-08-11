import { NextRequest } from "next/server";
import {
  addMessage,
  deleteMessagesFrom,
  getConversation,
  getProject,
  listMessages,
  listProjectFiles,
  snapshotTailAsBranch,
  updateConversation,
  updateMessageAttachments,
} from "@/lib/db";
import {
  buildSystemPrompt,
  fetchWithRetry,
  getSettings,
  historyHasMime,
  historyHasPdf,
  toApiMessage,
  type ChatCompletionMessage,
} from "@/lib/openrouter";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { resolveChatTarget, targetHeaders } from "@/lib/providers";
import { DOCX_MIME } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const MAX_MODELS = 4;

/**
 * "Second opinion" — run the same conversation context through several models
 * in parallel and stream all answers side by side. Deliberately does NOT lock
 * the conversation or persist anything: this is an exploratory preview. The
 * chosen answer is committed later via PUT. No tools/web-search/memory loop —
 * a clean, comparable answer from each model.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const body = await req.json();
  const conversation = await getConversation(body.conversationId);
  if (!conversation || conversation.user_id !== userId) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const rawModels: unknown = (body as { models?: unknown }).models;
  const models: string[] = Array.isArray(rawModels)
    ? [
        ...new Set(
          rawModels.filter(
            (m): m is string => typeof m === "string" && !!m.trim()
          )
        ),
      ].slice(0, MAX_MODELS)
    : [];
  if (models.length < 2) {
    return Response.json(
      { error: "Pick at least two models to compare" },
      { status: 400 }
    );
  }

  const settings = await getSettings(userId);
  const history = await listMessages(conversation.id);
  // Context = everything before the answer we're getting a second opinion on.
  const cut = body.truncateFromMessageId
    ? history.findIndex((m) => m.id === body.truncateFromMessageId)
    : -1;
  const context = cut >= 0 ? history.slice(0, cut) : history;
  if (!context.some((m) => m.role === "user")) {
    return Response.json({ error: "Nothing to compare" }, { status: 400 });
  }

  const project = conversation.project_id
    ? await getProject(conversation.project_id)
    : null;
  const lastUserContent =
    [...context].reverse().find((m) => m.role === "user")?.content ?? "";
  const systemPrompt = buildSystemPrompt(
    settings.systemPrompt,
    project
      ? { instructions: project.instructions, files: await listProjectFiles(project.id) }
      : null,
    { aboutUser: settings.aboutUser, styleInstructions: settings.styleInstructions },
    lastUserContent
  );

  // Extract PDF text once, up front — before the fan-out, so all columns see the
  // same text and one PDF isn't parsed once per model.
  let pdfNeedsProviderParse = false;
  if (historyHasPdf(context)) {
    try {
      const { ensurePdfText } = await import("@/lib/pdf");
      pdfNeedsProviderParse = await ensurePdfText(context, updateMessageAttachments);
    } catch (e) {
      console.error("PDF extraction unavailable:", e);
      pdfNeedsProviderParse = true;
    }
  }
  if (historyHasMime(context, DOCX_MIME)) {
    try {
      const { ensureDocxText } = await import("@/lib/docx");
      await ensureDocxText(context, updateMessageAttachments);
    } catch (e) {
      console.error("DOCX extraction unavailable:", e);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const emit = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          /* client gone — the other columns keep going, then we close */
        }
      };

      await Promise.allSettled(
        models.map(async (modelId, col) => {
          try {
            const target = await resolveChatTarget(modelId, userId);
            const apiMessages: ChatCompletionMessage[] = [];
            if (systemPrompt) {
              apiMessages.push({ role: "system", content: systemPrompt });
            }
            apiMessages.push(
              ...context.map((m) =>
                toApiMessage(m, {
                  rawPdfFallback: target.isOpenRouter && pdfNeedsProviderParse,
                })
              )
            );
            const reqBody = JSON.stringify({
              model: target.bodyModel,
              messages: apiMessages,
              stream: true,
              temperature: 0.7,
              ...(target.isOpenRouter
                ? { usage: { include: true } }
                : { stream_options: { include_usage: true } }),
            });
            const res = await fetchWithRetry(
              target.url,
              {
                method: "POST",
                headers: targetHeaders(target, reqBody),
                body: reqBody,
              },
              { signal: req.signal }
            );
            if (!res.ok || !res.body) {
              const detail = await res.text().catch(() => "");
              emit({
                col,
                error: `Model failed (${res.status})${
                  detail ? `: ${detail.slice(0, 120)}` : ""
                }`,
              });
              emit({ col, done: true, model: modelId });
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let cost = 0;
            let tokensIn = 0;
            let tokensOut = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) emit({ col, delta });
                  if (parsed.usage) {
                    cost += Number(parsed.usage.cost) || 0;
                    tokensIn = Number(parsed.usage.prompt_tokens) || tokensIn;
                    tokensOut = Number(parsed.usage.completion_tokens) || tokensOut;
                  }
                } catch {
                  /* skip malformed line */
                }
              }
            }
            emit({
              col,
              done: true,
              model: modelId,
              cost,
              tokens_in: tokensIn,
              tokens_out: tokensOut,
            });
          } catch (e) {
            emit({ col, error: String((e as Error).message || e).slice(0, 160) });
            emit({ col, done: true, model: modelId });
          }
        })
      );

      emit({ done: true });
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * Commit a chosen "second opinion" answer into the thread. Reuses the same
 * branch/variant machinery as regenerate: the answer being replaced is kept as
 * a switchable branch, then the picked answer is inserted verbatim (the exact
 * text the user saw — no re-generation, no extra cost).
 */
export async function PUT(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  const body = await req.json();
  const conversation = await getConversation(body.conversationId);
  if (!conversation || conversation.user_id !== userId) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!body.model || typeof body.content !== "string" || !body.content.trim()) {
    return Response.json(
      { error: "model and content are required" },
      { status: 400 }
    );
  }

  if (body.truncateFromMessageId) {
    let snapshotted = false;
    try {
      snapshotted = Boolean(
        await snapshotTailAsBranch(conversation.id, body.truncateFromMessageId)
      );
    } catch (e) {
      console.error("branch snapshot failed:", e);
    }
    await deleteMessagesFrom(conversation.id, body.truncateFromMessageId, {
      pruneArtifacts: !snapshotted,
    });
  }

  const saved = await addMessage(
    conversation.id,
    "assistant",
    body.content,
    body.model,
    null,
    {
      cost: Number(body.cost) || null,
      tokens_in: Number(body.tokens_in) || null,
      tokens_out: Number(body.tokens_out) || null,
    }
  );
  if (body.model !== conversation.model) {
    await updateConversation(conversation.id, { model: body.model });
  }
  return Response.json({ messageId: saved.id, model: body.model });
}
