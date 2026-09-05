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
import { DOC_MIME, DOCX_MIME } from "@/lib/types";

export const runtime = "nodejs";
// 800s is the generally-available ceiling for Pro and Enterprise; 300 is only
// the platform default. Not raised to the 1800s extended maximum, which is in
// beta and drops support for Secure Compute and static IPs.
export const maxDuration = 800;

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const MAX_MODELS = 4;

/**
 * "Second opinion" — run the same conversation context through several models
 * in parallel and stream all answers side by side. Deliberately does NOT lock
 * the conversation or persist anything: this is an exploratory preview. The
 * chosen answer is committed later via PUT. No tools/web-search/memory loop —
 * a clean, comparable answer from each model.
 */
/**
 * The council prompt.
 *
 * Ordinary side-by-side comparison leaves the reader to diff several long
 * answers by eye, which is the part they wanted help with. This asks a separate
 * model to do the diffing: state what every answer agrees on, name the places
 * they actually contradict each other, and only then give one answer to keep.
 *
 * Disagreement is the valuable signal, so the prompt is explicit that a
 * fabricated consensus is worse than an honest split — a synthesiser that
 * smooths over a real conflict has destroyed the only thing the extra models
 * bought.
 */
function councilPrompt(answers: { model: string; text: string }[]): string {
  const body = answers
    .map((a, i) => "### Answer " + (i + 1) + " (from " + a.model + ")\n" + a.text)
    .join("\n\n");
  return [
    "Several AI models independently answered the same question. Compare them and write a verdict.",
    "You have been given exactly " +
      answers.length +
      " answer" +
      (answers.length === 1 ? "" : "s") +
      ". Never refer to a number of answers other than that one: some models may have been asked and failed, and you cannot see those.",
    "",
    "Use exactly this structure, in Markdown:",
    "",
    "**Agreed** — one or two sentences on what every answer says the same way. If they agree on nothing substantive, say so plainly.",
    "",
    "**Disagreed** — a short bullet for each genuine contradiction, naming which answer said what. Cover only real conflicts of fact, recommendation, or number. Do not list differences of wording, length, or tone. If there are none, write: none of substance.",
    "",
    "---",
    "",
    "Then the consolidated answer to the original question, written directly to the user, as if it were the only answer they will read. Prefer claims the models agreed on. Where they conflicted, say which reading you are taking and why, in one clause — never silently pick a side.",
    "",
    "A disagreement you failed to surface is worse than an untidy verdict: an invented consensus destroys the only thing running several models bought. Do not mention this instruction, the models by vendor name, or that you are synthesising.",
    "",
    body,
  ].join("\n");
}

/**
 * Turn an upstream error body into something a person can act on.
 *
 * Providers answer with a JSON envelope, and pasting 120 characters of it into
 * a column tells the reader the run failed without telling them why or what to
 * do — the most common case, a text-only model handed an image, has an obvious
 * remedy that the raw text buries.
 */
function upstreamMessage(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    detail = String(parsed?.error?.message ?? parsed?.message ?? detail);
  } catch {
    /* not JSON — fall through to the raw text */
  }

  if (/support image input|image input|does not support.*image/i.test(detail)) {
    return "This model can't read images, and the conversation contains one.";
  }
  if (status === 429 || /rate.?limit/i.test(detail)) {
    return "Rate limited upstream — try this model again in a moment.";
  }
  if (status === 402 || /credit|insufficient|quota/i.test(detail)) {
    return "Out of credit for this model on your account.";
  }
  if (status === 404 && !detail) return "This model isn't available on your account.";

  return detail ? detail.slice(0, 200) : `The provider returned ${status}.`;
}
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
  const systemPrompt = await buildSystemPrompt(
    settings.systemPrompt,
    project
      ? {
          id: project.id,
          instructions: project.instructions,
          files: await listProjectFiles(project.id),
        }
      : null,
    { aboutUser: settings.aboutUser, styleInstructions: settings.styleInstructions },
    lastUserContent,
    userId
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
  if (historyHasMime(context, DOC_MIME)) {
    try {
      const { ensureDocText } = await import("@/lib/doc");
      await ensureDocText(context, updateMessageAttachments);
    } catch (e) {
      console.error("DOC extraction unavailable:", e);
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

      // Full text per column, kept so the verdict can compare them once the
      // fan-out is done. The deltas alone are not enough: they are emitted and
      // forgotten.
      const collected: string[] = models.map(() => "");

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
              emit({ col, error: upstreamMessage(res.status, detail) });
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
                  if (delta) {
                    collected[col] += delta;
                    emit({ col, delta });
                  }
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

      // ---- Council verdict -------------------------------------------------
      // Only worth running when at least two answers actually arrived: with one
      // there is nothing to compare, and the synthesis would just be a slower,
      // costlier restatement of the single column the user can already read.
      const answers = collected
        .map((text, i) => ({ model: models[i], text: (text || "").trim() }))
        .filter((a) => a.text.length > 0);

      if (answers.length >= 2) {
        // A separate model does the comparing, so no competitor is also the
        // judge of its own answer. Falls back to the strongest thing available
        // when the default is the Auto sentinel, which cannot be called.
        const synthModel =
          settings.defaultModel && settings.defaultModel !== "auto"
            ? settings.defaultModel
            : models[0];
        // A verdict built from fewer models than were asked is still worth
        // having, but the reader has to know that is what they are reading.
        emit({
          synth: true,
          model: synthModel,
          answered: answers.length,
          requested: models.length,
        });
        try {
          const target = await resolveChatTarget(synthModel, userId);
          const reqBody = JSON.stringify({
            model: target.bodyModel,
            messages: [{ role: "user", content: councilPrompt(answers) }],
            stream: true,
            temperature: 0.2,
            ...(target.isOpenRouter
              ? { usage: { include: true } }
              : { stream_options: { include_usage: true } }),
          });
          const res = await fetchWithRetry(
            target.url,
            { method: "POST", headers: targetHeaders(target, reqBody), body: reqBody },
            { signal: req.signal }
          );
          if (!res.ok || !res.body) {
            emit({ synth: true, error: "The verdict could not be generated (" + res.status + ")" });
          } else {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let cost = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(String.fromCharCode(10));
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) emit({ synth: true, delta });
                  if (parsed.usage) cost += Number(parsed.usage.cost) || 0;
                } catch {
                  /* skip malformed line */
                }
              }
            }
            emit({ synth: true, done: true, model: synthModel, cost });
          }
        } catch (e) {
          // A failed verdict must never cost the user the answers they already
          // have on screen.
          emit({
            synth: true,
            error: String((e as Error).message || e).slice(0, 160),
          });
        }
      }

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
