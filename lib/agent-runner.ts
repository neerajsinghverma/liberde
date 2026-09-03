import {
  addMessage,
  updateAgentRun,
  updateMessageContent,
  updateMessageCost,
} from "./db";
import { complete, fetchWithRetry, dateContextLine } from "./openrouter";
import { assembleTools, callTool } from "./mcp";
import { BUILTIN_TOOL_DEFS, execBuiltinTool, isBuiltinTool } from "./builtin-tools";
import { execPlatformTool, isPlatformTool, PLATFORM_TOOL_DEFS } from "./platform-tools";
import { sendPushToUser } from "./push";
import { execMemoryTool, isMemoryTool, MEMORY_TOOL_DEFS } from "./memory";
import { processAssistantArtifacts } from "./artifacts";
import { ARTIFACTS_SYSTEM_PROMPT } from "./artifact-shared";
import { resolveChatTarget, targetHeaders } from "./providers";
import { applyPromptCache, cacheSessionId } from "./prompt-cache";
import { audit } from "./audit";
import type { AgentRun, AgentStep } from "./types";

export const MAX_STEPS = 5;
const MAX_ROUNDS_PER_STEP = 4;
// The planner's reply is prose around a JSON array; this pulls the array out.
const PLAN_ARRAY = /\[[\s\S]*\]/;

type Emit = (obj: unknown) => void;

/**
 * Read a planner reply into steps.
 *
 * Accepts the grouped object form and the bare string array that older runs
 * and weaker planner models produce; a string array becomes one step per
 * group, which is exactly the sequential behaviour this used to have.
 *
 * Output is sorted by group so a group's members sit next to each other in
 * the array. That contiguity is what lets `current_step` stay a single
 * integer, and it is the whole reason resume still works unchanged.
 */
export function parsePlan(reply: string): AgentStep[] {
  let parsed: unknown;
  try {
    const match = reply.match(PLAN_ARRAY);
    parsed = JSON.parse(match ? match[0] : "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: AgentStep[] = [];
  parsed.slice(0, MAX_STEPS).forEach((raw, i) => {
    // A planner that ignored the schema still gets its plan honoured, one
    // step per group — degraded to sequential rather than dropped.
    if (typeof raw === "string") {
      const title = raw.trim();
      if (title) out.push({ title, status: "pending", group: i + 1 });
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const o = raw as { title?: unknown; group?: unknown };
    const title = String(o.title ?? "").trim();
    if (!title) return;
    const g = Number(o.group);
    out.push({
      title,
      status: "pending",
      group: Number.isFinite(g) && g > 0 ? Math.floor(g) : i + 1,
    });
  });

  // Stable sort: equal groups keep the planner's ordering.
  return out
    .map((step, i) => ({ step, i }))
    .sort((a, b) => (a.step.group ?? 0) - (b.step.group ?? 0) || a.i - b.i)
    .map(({ step }) => step);
}

/** The group a step belongs to; ungrouped legacy steps stand alone. */
const groupOf = (steps: AgentStep[], i: number): number => steps[i].group ?? i + 1;
/**
 * Execute one *slice* of a durable agent run: plan (if not yet planned), then
 * run steps from `run.current_step` until the wall-clock `deadlineMs` or the
 * plan is exhausted, then synthesize the deliverable. State is persisted to the
 * `agent_runs` row after every step, so a slice that pauses (deadline hit) or a
 * function that gets killed can be resumed exactly where it left off.
 *
 * Returns:
 *  - "paused": steps remain but the deadline was reached; caller should resume.
 *  - "done":   the deliverable was produced (a `done` event was emitted).
 *  - "error":  the run failed unrecoverably (an `error` event was emitted).
 */
export async function runAgentSlice(
  run: AgentRun,
  emit: Emit,
  opts: { deadlineMs: number; memoryEnabled: boolean }
): Promise<"paused" | "done" | "error"> {
  const { deadlineMs, memoryEnabled } = opts;
  let totalCost = run.total_cost;
  const notes = [...run.notes];
  const steps: AgentStep[] = [...run.steps];
  let runMsgId = run.run_msg_id;

  const { tools: mcpTools } = await assembleTools(run.user_id);
  const tools = [
    ...BUILTIN_TOOL_DEFS,
    ...PLATFORM_TOOL_DEFS,
    ...(memoryEnabled ? MEMORY_TOOL_DEFS : []),
    ...mcpTools,
  ];
  const toolNames = tools.map((t) => t.function.name).join(", ");

  const progressBlock = () =>
    `🤖 **Working on:** ${run.goal}\n\n${steps
      .map(
        (s) =>
          `${s.status === "done" ? "✓" : s.status === "failed" ? "⚠" : "▢"} ${s.title}`
      )
      .join("\n")}`;

  const runStep = async (
    messages: {
      role: string;
      content: string | { type: string; [k: string]: unknown }[];
      tool_calls?: unknown[];
      tool_call_id?: string;
    }[]
  ): Promise<string> => {
    for (let round = 0; round < MAX_ROUNDS_PER_STEP; round++) {
      const execTarget = await resolveChatTarget(run.exec_model, run.user_id);
      if (round === 0) {
        applyPromptCache(messages, {
          model: execTarget.bodyModel,
          isOpenRouter: execTarget.isOpenRouter,
        });
      }
      // Per-call 90s timeout + one retry; decoupled from any client signal so a
      // disconnect never cancels work we intend to persist.
      const execBody = JSON.stringify({
        model: execTarget.bodyModel,
        messages,
        ...(execTarget.isOpenRouter
          ? { usage: { include: true }, session_id: cacheSessionId(run.id) }
          : {}),
        ...(round < MAX_ROUNDS_PER_STEP - 1 && tools.length ? { tools } : {}),
      });
      const res = await fetchWithRetry(
        execTarget.url,
        {
          method: "POST",
          headers: targetHeaders(execTarget, execBody),
          body: execBody,
        },
        { retries: 1, timeoutMs: 90_000 }
      );
      if (!res.ok) throw new Error(`step failed (${res.status})`);
      const data = await res.json();
      totalCost += Number(data.usage?.cost) || 0;
      const message = data.choices?.[0]?.message;
      const calls = (message?.tool_calls ?? []) as {
        id: string;
        function: { name: string; arguments: string };
      }[];
      if (!calls.length) return message?.content ?? "";

      messages.push({ role: "assistant", content: message?.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const label =
          call.function.name === "web_search"
            ? `Searching: ${JSON.parse(call.function.arguments || "{}").query ?? ""}`
            : `Using ${call.function.name.replace(/__/g, ": ")}`;
        emit({ status: `  ${label}` });
        let output: string;
        if (isMemoryTool(call.function.name)) {
          output = await execMemoryTool(call.function.name, call.function.arguments, run.user_id);
        } else if (isPlatformTool(call.function.name)) {
          const result = await execPlatformTool(
            call.function.name,
            call.function.arguments,
            run.user_id
          );
          output = result.output;
          if (result.toolsChanged) {
            const { tools: refreshed } = await assembleTools(run.user_id);
            tools.length = 0;
            tools.push(
              ...BUILTIN_TOOL_DEFS,
              ...PLATFORM_TOOL_DEFS,
              ...(memoryEnabled ? MEMORY_TOOL_DEFS : []),
              ...refreshed
            );
          }
        } else if (isBuiltinTool(call.function.name)) {
          const result = await execBuiltinTool(call.function.name, call.function.arguments, run.user_id);
          output = result.output;
          totalCost += result.cost ?? 0;
        } else {
          output = await callTool(call.function.name, call.function.arguments, run.user_id);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    return "(step hit its tool-round limit)";
  };

  try {
    // 1. Plan — only if this run hasn't been planned yet.
    if (steps.length === 0) {
      emit({ status: "Planning…" });
      let planned: AgentStep[] = [];
      try {
        const plan = await complete(
          run.planner_model,
          [
            {
              role: "user",
              content: [
                `${dateContextLine()} You are an autonomous agent. Break this goal into at most ${MAX_STEPS} concrete steps (fewer is better; the last step produces the deliverable). Available tools: ${toolNames || "none"}.`,
                `Give every step a "group" number. Steps sharing a number run at the SAME TIME and cannot see each other's findings, so only share a number when neither step needs the other's output. Groups run in ascending order, and every step sees the findings of all earlier groups.

Gathering from independent sources belongs in one shared group. Anything that compares, summarises, decides, or builds on earlier work belongs in a later group. When in doubt use a later group — a wrongly parallelised step runs blind.`,
                run.context_block,
                `Reply with ONLY a JSON array, for example: [{"title":"Research X","group":1},{"title":"Research Y","group":1},{"title":"Compare and write up","group":2}]`,
              ].join("\n\n"),
            },
          ],
          { temperature: 0.3, max_tokens: 500 },
          run.user_id
        );
        planned = parsePlan(plan);
      } catch {
        /* fall through to default */
      }
      if (planned.length === 0) {
        planned = [
          { title: "Work on the goal", status: "pending", group: 1 },
          { title: "Produce the deliverable", status: "pending", group: 2 },
        ];
      }
      steps.push(...planned);
      const groups = new Set(steps.map((s, i) => s.group ?? i + 1)).size;
      emit({
        status:
          `Plan: ${steps.length} steps` +
          (groups < steps.length ? ` in ${groups} stages (some run together)` : ""),
      });
      steps.forEach((s, i) => emit({ status: `   ${i + 1}. ${s.title}` }));
      const runMsg = await addMessage(run.conversation_id, "assistant", progressBlock(), run.model);
      runMsgId = runMsg.id;
      await updateAgentRun(run.id, { steps, run_msg_id: runMsgId });
      await audit({
        action: "agent.run_started",
        userId: run.user_id,
        targetType: "agent_run",
        targetId: run.id,
        detail: { steps: steps.length, groups },
      });
    }

    // 2. Execute from where we left off, pausing at the deadline.
    //
    //    Steps sharing a group were planned as mutually independent, so they
    //    run together. Groups stay ordered, because a later group is exactly
    //    the thing allowed to depend on an earlier one. A group is contiguous
    //    in the array (parsePlan sorted it), so `current_step` stays a single
    //    integer and resume works unchanged.
    let i = run.current_step;
    while (i < steps.length) {
      if (Date.now() > deadlineMs) {
        await updateAgentRun(run.id, {
          steps,
          current_step: i,
          notes,
          total_cost: totalCost,
          status: "running",
        });
        if (runMsgId) {
          await updateMessageContent(runMsgId, progressBlock());
          await updateMessageCost(runMsgId, totalCost);
        }
        emit({ status: `Pausing at step ${i + 1}/${steps.length} — resuming shortly` });
        return "paused";
      }

      let end = i;
      while (end + 1 < steps.length && groupOf(steps, end + 1) === groupOf(steps, i)) end++;
      const batch: number[] = [];
      for (let k = i; k <= end; k++) batch.push(k);

      // Snapshotted before the batch starts: a step must not read notes its
      // own siblings are still writing, or "independent" stops being true and
      // the run stops being reproducible.
      const priorNotes = notes.length ? notes.join("\n\n") : "(none yet)";
      const planText = steps.map((s, j) => `${j + 1}. ${s.title}`).join("\n");

      if (batch.length === 1) {
        emit({ status: `Step ${i + 1}/${steps.length}: ${steps[i].title}` });
      } else {
        emit({ status: `Steps ${i + 1}-${end + 1}/${steps.length}, running together:` });
        for (const k of batch) emit({ status: `   ▸ ${steps[k].title}` });
      }

      // MAX_STEPS caps a whole plan at five, so one group can never be wide
      // enough to need a concurrency limit of its own.
      const settled = await Promise.allSettled(
        batch.map((k) =>
          runStep([
            {
              role: "system",
              content:
                `${dateContextLine()} You are executing one step of a plan. Be thorough but focused on THIS step only. Use tools when they genuinely help. Report your findings as dense, factual text.` +
                (batch.length > 1
                  ? ` Other steps in this stage are running at the same time; you cannot see their work, and must not wait on it or assume what it found.`
                  : ""),
            },
            {
              role: "user",
              content: [
                run.context_block,
                `Plan:\n${planText}`,
                `Findings from earlier stages:\n${priorNotes}`,
                `Execute step ${k + 1}: ${steps[k].title}`,
              ].join("\n\n"),
            },
          ])
        )
      );

      // Applied in batch order rather than completion order, so the notes a
      // later group reads are identical whichever sibling finished first.
      settled.forEach((outcome, idx) => {
        const k = batch[idx];
        if (outcome.status === "fulfilled") {
          notes.push(`## Step ${k + 1}: ${steps[k].title}\n${outcome.value.slice(0, 4000)}`);
          steps[k].status = "done";
          emit({ status: `Step ${k + 1} done` });
        } else {
          steps[k].status = "failed";
          const why = String(outcome.reason).slice(0, 120);
          notes.push(`## Step ${k + 1}: ${steps[k].title}\n(this step could not complete: ${why})`);
          emit({ status: `Step ${k + 1} skipped (${why.slice(0, 60)})` });
        }
      });

      i = end + 1;
      await updateAgentRun(run.id, {
        steps,
        current_step: i,
        notes,
        total_cost: totalCost,
      });
      if (runMsgId) {
        try {
          await updateMessageContent(runMsgId, progressBlock());
        } catch {
          /* non-fatal */
        }
      }
    }


    // 3. Synthesize the deliverable, streaming deltas to the client.
    emit({ status: "Producing the deliverable…" });
    await updateAgentRun(run.id, { status: "synthesizing" });
    const synthTarget = await resolveChatTarget(run.model, run.user_id);
    const synthBody = JSON.stringify({
      model: synthTarget.bodyModel,
      stream: true,
      ...(synthTarget.isOpenRouter ? { usage: { include: true } } : {}),
      messages: [
        {
          role: "system",
          content: `${dateContextLine()} You executed a plan and must now present the final deliverable to the user. Lead with the deliverable itself, then a brief note on how you got there. ${ARTIFACTS_SYSTEM_PROMPT}`,
        },
        {
          role: "user",
          content: `${run.context_block}\n\nStep results:\n${notes.join("\n\n")}\n\nProduce the final deliverable now (use an artifact if it's a document, page, deck, or app).`,
        },
      ],
    });
    const synthRes = await fetchWithRetry(
      synthTarget.url,
      {
        method: "POST",
        headers: targetHeaders(synthTarget, synthBody),
        body: synthBody,
      },
      { retries: 1 }
    );
    if (!synthRes.ok || !synthRes.body) throw new Error(`synthesis failed (${synthRes.status})`);

    let final = "";
    const reader = synthRes.body.getReader();
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
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            final += delta;
            emit({ delta });
          }
          if (parsed.usage) totalCost += Number(parsed.usage.cost) || 0;
        } catch {
          /* skip */
        }
      }
    }

    const planBlock = `*Plan executed:*\n${steps
      .map((s, j) => `${j + 1}. ${s.status === "failed" ? "⚠" : "✓"} ${s.title}`)
      .join("\n")}\n\n---\n\n`;
    const finalContent = planBlock + (final || "(the agent produced no final output)");
    if (runMsgId) {
      await updateMessageContent(runMsgId, finalContent);
      await updateMessageCost(runMsgId, totalCost);
      try {
        await processAssistantArtifacts(run.conversation_id, runMsgId, final);
      } catch {
        /* non-fatal */
      }
    }
    await updateAgentRun(run.id, { status: "done", steps, notes, total_cost: totalCost });
    emit({ done: true, messageId: runMsgId });
    await sendPushToUser(run.user_id, {
      title: "🤖 Agent run finished",
      body: run.goal.replace(/\s+/g, " ").slice(0, 140),
      url: `/c/${run.conversation_id}`,
    });
    return "done";
  } catch (e) {
    const partial = notes.length
      ? `⚠ This agent run was cut short (${String(e).slice(0, 100)}), but here's the progress so far:\n\n${notes.join("\n\n")}`
      : `⚠ This agent run couldn't complete: ${String(e).slice(0, 200)}`;
    try {
      if (runMsgId) {
        await updateMessageContent(runMsgId, partial);
        await updateMessageCost(runMsgId, totalCost);
      } else {
        const saved = await addMessage(run.conversation_id, "assistant", partial, run.model, null, {
          cost: totalCost || null,
        });
        runMsgId = saved.id;
        await updateAgentRun(run.id, { run_msg_id: runMsgId });
      }
    } catch {
      /* best effort */
    }
    await updateAgentRun(run.id, {
      status: "error",
      error: String(e).slice(0, 500),
      total_cost: totalCost,
    });
    emit({ error: String(e), messageId: runMsgId });
    return "error";
  }
}
