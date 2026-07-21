import {
  addMessage,
  updateAgentRun,
  updateMessageContent,
  updateMessageCost,
} from "./db";
import { complete, fetchWithRetry } from "./openrouter";
import { assembleTools, callTool } from "./mcp";
import { BUILTIN_TOOL_DEFS, execBuiltinTool, isBuiltinTool } from "./builtin-tools";
import { execPlatformTool, isPlatformTool, PLATFORM_TOOL_DEFS } from "./platform-tools";
import { sendPushToUser } from "./push";
import { execMemoryTool, isMemoryTool, MEMORY_TOOL_DEFS } from "./memory";
import { processAssistantArtifacts } from "./artifacts";
import { ARTIFACTS_SYSTEM_PROMPT } from "./artifact-shared";
import { resolveChatTarget, targetHeaders } from "./providers";
import type { AgentRun, AgentStep } from "./types";

export const MAX_STEPS = 5;
const MAX_ROUNDS_PER_STEP = 4;

type Emit = (obj: unknown) => void;

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
    messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[]
  ): Promise<string> => {
    for (let round = 0; round < MAX_ROUNDS_PER_STEP; round++) {
      const execTarget = await resolveChatTarget(run.exec_model, run.user_id);
      // Per-call 90s timeout + one retry; decoupled from any client signal so a
      // disconnect never cancels work we intend to persist.
      const execBody = JSON.stringify({
        model: execTarget.bodyModel,
        messages,
        ...(execTarget.isOpenRouter ? { usage: { include: true } } : {}),
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
      let titles: string[] = [];
      try {
        const plan = await complete(
          run.planner_model,
          [
            {
              role: "user",
              content: `You are an autonomous agent. Break this into at most ${MAX_STEPS} concrete, sequential steps (fewer is better; the final step should produce the deliverable). Available tools: ${toolNames || "none"}.\n\n${run.context_block}\n\nReply with ONLY a JSON array of short step titles.`,
            },
          ],
          { temperature: 0.3, max_tokens: 400 },
          run.user_id
        );
        const parsed = JSON.parse(plan.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
        if (Array.isArray(parsed)) titles = parsed.slice(0, MAX_STEPS).map(String);
      } catch {
        /* fall through to default */
      }
      if (titles.length === 0) titles = ["Work on the goal", "Produce the deliverable"];
      for (const t of titles) steps.push({ title: t, status: "pending" });
      emit({ status: `Plan: ${steps.length} steps` });
      steps.forEach((s, i) => emit({ status: `   ${i + 1}. ${s.title}` }));
      const runMsg = await addMessage(run.conversation_id, "assistant", progressBlock(), run.model);
      runMsgId = runMsg.id;
      await updateAgentRun(run.id, { steps, run_msg_id: runMsgId });
    }

    // 2. Execute steps from where we left off, pausing at the deadline.
    for (let i = run.current_step; i < steps.length; i++) {
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
      emit({ status: `Step ${i + 1}/${steps.length}: ${steps[i].title}` });
      try {
        const result = await runStep([
          {
            role: "system",
            content: `You are executing one step of a plan. Be thorough but focused on THIS step only. Use tools when they genuinely help. Report your findings/output for the step as dense, factual text.`,
          },
          {
            role: "user",
            content: `${run.context_block}\n\nPlan:\n${steps.map((s, j) => `${j + 1}. ${s.title}`).join("\n")}\n\nFindings from previous steps:\n${notes.length ? notes.join("\n\n") : "(none yet)"}\n\nExecute step ${i + 1}: ${steps[i].title}`,
          },
        ]);
        notes.push(`## Step ${i + 1}: ${steps[i].title}\n${result.slice(0, 4000)}`);
        steps[i].status = "done";
        emit({ status: `Step ${i + 1} done` });
      } catch (e) {
        steps[i].status = "failed";
        notes.push(`## Step ${i + 1}: ${steps[i].title}\n(this step could not complete: ${String(e).slice(0, 120)})`);
        emit({ status: `Step ${i + 1} skipped (${String(e).slice(0, 60)})` });
      }
      await updateAgentRun(run.id, {
        steps,
        current_step: i + 1,
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
          content: `You executed a plan and must now present the final deliverable to the user. Lead with the deliverable itself, then a brief note on how you got there. ${ARTIFACTS_SYSTEM_PROMPT}`,
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
