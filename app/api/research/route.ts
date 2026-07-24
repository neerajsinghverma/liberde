import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  addMessage,
  getApiKey,
  getConversation,
  listMessages,
  tryLockConversation,
  unlockConversation,
  updateConversation,
} from "@/lib/db";
import {
  complete,
  getSettings,
  openRouterHeaders,
  OPENROUTER_BASE,
} from "@/lib/openrouter";
import { resolveChatTarget, targetHeaders } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 300;

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const MAX_SEARCHES = 6;

/**
 * Deep Research: plan search queries → run web searches in parallel →
 * synthesize a cited report with the conversation's model, streaming progress.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const conversation = await getConversation(body.conversationId);
  if (!conversation || (conversation.user_id && conversation.user_id !== userId)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!(await getApiKey(userId))) {
    return Response.json(
      { error: "No OpenRouter API key configured. Add one in Settings." },
      { status: 400 }
    );
  }
  const query = (body.query ?? "").trim();
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });
  if (!(await tryLockConversation(conversation.id))) {
    return Response.json(
      { error: "A response is already being generated in this conversation." },
      { status: 429 }
    );
  }

  let settings, model, contextBlock = "";
  try {
    settings = await getSettings(userId);
    model = body.model || conversation.model || settings.defaultModel;
    // Pull recent conversation so research can resolve follow-ups like "ya
    // research" / "dig into that" against what was actually being discussed —
    // rather than researching the literal words of the message.
    const history = await listMessages(conversation.id);
    contextBlock = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 1200)}`)
      .join("\n");
    await addMessage(conversation.id, "user", query);
  } catch (e) {
    await unlockConversation(conversation.id);
    console.error("research setup failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to start research" },
      { status: 500 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          /* client gone; keep working so the result is persisted */
        }
      };

      let totalCost = 0;
      const runStart = Date.now();
      // The web-search rounds (search plugin + reader model) vs the synthesis
      // model — attributed separately on the Usage page.
      let searchCost = 0;
      try {
        // 1. Plan
        emit({ status: "Planning research…" });
        let queries: string[] = [query];
        try {
          const plan = await complete(
            settings.plannerModel || settings.titleModel,
            [
              {
                role: "user",
                content: `${contextBlock ? `Recent conversation for context:\n${contextBlock}\n\n` : ""}The user now asks to research: "${query}". Using the conversation context, work out what they ACTUALLY want researched (resolve vague references like "this", "that", "ya research", "dig deeper" to the real subject). Generate up to ${MAX_SEARCHES} focused, diverse web search queries on that subject. Reply with ONLY a JSON array of strings.`,
              },
            ],
            { temperature: 0.3, max_tokens: 300 }, userId
          );
          const parsed = JSON.parse(plan.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
          if (Array.isArray(parsed) && parsed.length > 0) {
            queries = parsed.slice(0, MAX_SEARCHES).map(String);
          }
        } catch {
          /* fall back to the raw question as the single query */
        }

        // 2. Search — run queries in parallel. Reused across rounds.
        const runSearches = (qs: string[]) =>
          Promise.all(
            qs.map(async (q) => {
              emit({ status: `Searching: ${q}` });
              try {
                const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
                  method: "POST",
                  headers: await openRouterHeaders(userId),
                  body: JSON.stringify({
                    model: settings.titleModel,
                    plugins: [{ id: "web", max_results: 5 }],
                    usage: { include: true },
                    messages: [
                      {
                        role: "user",
                        content: `Research this and report the key facts, figures, and claims you find, densely and factually: ${q}`,
                      },
                    ],
                  }),
                  signal: req.signal,
                });
                if (!res.ok) throw new Error(`search failed (${res.status})`);
                const data = await res.json();
                totalCost += Number(data.usage?.cost) || 0;
                searchCost += Number(data.usage?.cost) || 0;
                const message = data.choices?.[0]?.message;
                return {
                  query: q,
                  findings: message?.content ?? "",
                  annotations: (message?.annotations ?? []) as unknown[],
                };
              } catch (e) {
                emit({ status: `Search failed: ${q}` });
                return { query: q, findings: `(search failed: ${e})`, annotations: [] };
              }
            })
          );

        emit({ status: `Researching — round 1 (${queries.length} threads)…` });
        const round1 = await runSearches(queries);

        // Round 2: read round-1 findings, then chase gaps / verify key claims.
        let followups: string[] = [];
        try {
          const r1 = round1.map((s) => s.findings).join("\n\n").slice(0, 7000);
          const fu = await complete(
            settings.plannerModel || settings.titleModel,
            [
              {
                role: "user",
                content: `${contextBlock ? `Conversation context:\n${contextBlock}\n\n` : ""}The user asked to research "${query}" (interpreted using the context above). Initial findings are below. List up to ${MAX_SEARCHES} follow-up web-search queries that fill gaps, verify key claims, add recent data, or go deeper. Reply with ONLY a JSON array of strings.\n\n${r1}`,
              },
            ],
            { temperature: 0.3, max_tokens: 300 },
            userId
          );
          const parsed = JSON.parse(fu.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
          if (Array.isArray(parsed)) followups = parsed.slice(0, MAX_SEARCHES).map(String);
        } catch {
          /* skip round 2 if planning fails */
        }
        let round2: typeof round1 = [];
        if (followups.length) {
          emit({ status: `Researching — round 2 (${followups.length} follow-ups)…` });
          round2 = await runSearches(followups);
        }

        const searches = [...round1, ...round2];
        const allAnnotations = searches.flatMap((s) => s.annotations);
        const sourceList = allAnnotations
          .map((a, i) => {
            const c = (a as { url_citation?: { url?: string; title?: string } })
              .url_citation;
            return c?.url ? `[${i + 1}] ${c.title ?? c.url} — ${c.url}` : null;
          })
          .filter(Boolean)
          .join("\n");

        // 3. Synthesize with the conversation's model, streaming
        emit({ status: "Synthesizing report…" });
        const findingsBlock = searches
          .map((s) => `## Search: ${s.query}\n${s.findings}`)
          .join("\n\n");
        const synthTarget = await resolveChatTarget(model, userId);
        const synthBody = JSON.stringify({
          model: synthTarget.bodyModel,
          stream: true,
          ...(synthTarget.isOpenRouter ? { usage: { include: true } } : {}),
          messages: [
            {
              role: "system",
              content:
                "You are a senior research analyst. Write a comprehensive, well-structured markdown report answering the user's question using ALL of the provided findings. Structure it: a 2–4 sentence executive summary; then themed sections with ## headings that synthesize across sources (don't just list what each search found); be specific with figures, dates, and named entities; note disagreements or uncertainty between sources; cite claims inline as [n] using the numbered source list; and end with a Conclusion and, where useful, a short table comparing key options/data. Aim for depth and completeness. Never fabricate sources or citations.",
            },
            {
              role: "user",
              content: `${contextBlock ? `Recent conversation (for context — the request may refer back to it):\n${contextBlock}\n\n` : ""}The user's research request: "${query}"\n\n# Findings\n${findingsBlock}\n\n# Sources\n${sourceList || "(no sources returned)"}`,
            },
          ],
        });
        const synthRes = await fetch(synthTarget.url, {
          method: "POST",
          headers: targetHeaders(synthTarget, synthBody),
          body: synthBody,
          signal: req.signal,
        });
        if (!synthRes.ok || !synthRes.body) {
          throw new Error(`synthesis failed (${synthRes.status})`);
        }

        let report = "";
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
                report += delta;
                emit({ delta });
              }
              if (parsed.usage) totalCost += Number(parsed.usage.cost) || 0;
            } catch {
              /* skip */
            }
          }
        }

        const saved = await addMessage(
          conversation.id,
          "assistant",
          report || "(research produced no report)",
          model,
          null,
          {
            annotations: allAnnotations.length ? allAnnotations : null,
            cost: totalCost || null,
            cost_breakdown: totalCost
              ? JSON.stringify({
                  model: Math.max(0, totalCost - searchCost),
                  ...(searchCost > 0 ? { search: searchCost } : {}),
                })
              : null,
            duration_ms: Date.now() - runStart,
          }
        );
        if (conversation.title === "New chat") {
          await updateConversation(conversation.id, {
            title: `🔬 ${query.slice(0, 70)}`,
          });
        }
        emit({ done: true, messageId: saved.id });
      } catch (e) {
        emit({ error: String(e) });
      } finally {
        await unlockConversation(conversation.id);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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
