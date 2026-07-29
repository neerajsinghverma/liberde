import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  addMessage,
  createAgentRun,
  getAgentRun,
  getApiKey,
  getConversation,
  listMessages,
  tryLockConversation,
  unlockConversation,
  updateConversation,
} from "@/lib/db";
import { complete, getSettings, keyProblem, resolveAutoModel } from "@/lib/openrouter";
import { runAgentSlice } from "@/lib/agent-runner";
import type { AgentRun } from "@/lib/types";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
// Leave headroom under maxDuration (300s) for synthesis + finalize before the
// platform hard-kills the function; steps past this pause and are resumed.
const SLICE_BUDGET_MS = 220_000;

/**
 * Agent mode: durable, resumable plan → execute → deliverable. Each request
 * runs one *slice* of the run; if the wall-clock budget is hit with steps
 * remaining, it emits `{ paused, runId }` and the client re-invokes with
 * `resumeRunId` to continue. State lives in the `agent_runs` table, so a run
 * survives serverless timeouts (and a server-side backstop resumes orphans).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const conversation = await getConversation(body.conversationId);
  if (!conversation || (conversation.user_id && conversation.user_id !== userId)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    return Response.json(
      { error: "No OpenRouter API key configured. Add one in Settings." },
      { status: 400 }
    );
  }
  {
    const prob = keyProblem(apiKey);
    if (prob) return Response.json({ error: prob }, { status: 400 });
  }

  const resumeRunId: string | undefined = body.resumeRunId;
  const goal = (body.goal ?? "").trim();
  if (!resumeRunId && !goal) {
    return Response.json({ error: "goal is required" }, { status: 400 });
  }

  if (!(await tryLockConversation(conversation.id))) {
    return Response.json(
      { error: "A response is already being generated in this conversation." },
      { status: 429 }
    );
  }

  let settings, model, plannerModel, execModel;
  try {
    settings = await getSettings(userId);
    model = body.model || conversation.model || settings.defaultModel;
    // If the conversation is on Auto, resolve it to a concrete model (the router
    // never leaks the "auto" sentinel into provider resolution).
    model = (await resolveAutoModel(model, { content: goal, settings, userId })).model;
    // Cost control: cheap planner/executor models when configured, main model for synthesis.
    plannerModel = settings.plannerModel || model;
    execModel = settings.agentExecModel || model;
  } catch (e) {
    await unlockConversation(conversation.id);
    console.error("agent setup failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to start agent" },
      { status: 500 }
    );
  }

  const memoryEnabled = settings.memoryEnabled;

  // Signals completion of the run's server-side work. Registered with
  // waitUntil so Fluid Compute keeps the function alive until the run
  // finishes (or pauses) even if the client disconnects mid-stream — the
  // deliverable and its push notification always land.
  let resolveWork!: () => void;
  const workDone = new Promise<void>((r) => (resolveWork = r));
  // No-op off Vercel (no request scope) — the local persistent server keeps the
  // process alive anyway, so only guard against waitUntil throwing there.
  try {
    waitUntil(workDone);
  } catch {
    /* not in a Vercel request scope */
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          /* client gone; keep working so the result persists */
        }
      };

      try {
        let run: AgentRun | null = null;

        if (resumeRunId) {
          run = await getAgentRun(resumeRunId);
          if (!run || run.conversation_id !== conversation.id || run.user_id !== userId) {
            emit({ error: "Agent run not found" });
            return;
          }
          if (run.status === "done" || run.status === "error") {
            emit({ done: true, messageId: run.run_msg_id });
            return;
          }
        } else {
          // Clarify first, like a real teammate — but only on the opening turn.
          const history = await listMessages(conversation.id);
          const priorAssistant = history.some((m) => m.role === "assistant");
          const contextBlock = priorAssistant
            ? "The request and the user's clarifying answers:\n" +
              history
                .filter((m) => m.role === "user" || m.role === "assistant")
                .slice(-8)
                .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
                .join("\n")
            : `Goal: ${goal}`;

          await addMessage(conversation.id, "user", goal);

          if (!priorAssistant) {
            emit({ status: "Checking the request…" });
            try {
              const raw = await complete(
                plannerModel,
                [
                  {
                    role: "user",
                    content: `A user asked an agent to: "${goal}". If it is clear enough to execute well, reply {"ok":true}. If key details are genuinely missing (scope, audience, format, tech, constraints), reply {"ok":false,"questions":[{"q":"…","options":["…","…"],"multi":false}]} with 2-4 short questions, each offering 2-4 concrete answer options the user can pick from. Reply with ONLY JSON.`,
                  },
                ],
                { temperature: 0.2, max_tokens: 500 },
                userId
              );
              const verdict = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
              if (verdict.ok === false && Array.isArray(verdict.questions) && verdict.questions.length) {
                const msg =
                  "Before I start, a few quick questions so I get this right:\n\n" +
                  `<liberdeAsk>${JSON.stringify(verdict.questions.slice(0, 4))}</liberdeAsk>`;
                const saved = await addMessage(conversation.id, "assistant", msg, model);
                emit({ delta: msg });
                emit({ done: true, messageId: saved.id });
                return;
              }
            } catch {
              /* if the check fails, just proceed */
            }
          }

          run = await createAgentRun({
            conversationId: conversation.id,
            userId,
            goal,
            model,
            plannerModel,
            execModel,
            contextBlock,
          });
          if (conversation.title === "New chat") {
            await updateConversation(conversation.id, { title: `🤖 ${goal.slice(0, 70)}` });
          }
        }

        const result = await runAgentSlice(run, emit, {
          deadlineMs: Date.now() + SLICE_BUDGET_MS,
          memoryEnabled,
        });
        if (result === "paused") {
          // The client re-invokes with resumeRunId to continue the next slice.
          emit({ paused: true, runId: run.id });
        }
      } catch (e) {
        emit({ error: String(e) });
      } finally {
        await unlockConversation(conversation.id);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        resolveWork();
      }
    },
    cancel() {
      // Client disconnected. Work keeps running (waitUntil holds the function
      // open); this just stops us trying to enqueue into a dead stream.
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
