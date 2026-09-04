import { NextRequest } from "next/server";
import {
  addMessage,
  canAccessDesignSystem,
  deleteMessagesFrom,
  getApiKey,
  getConversation,
  getLastAssistantModel,
  getDesignSystem,
  getProject,
  listMessages,
  listProjectFiles,
  snapshotTailAsBranch,
  tryLockConversation,
  unlockConversation,
  setLiveTurn,
  workspaceBudgetsFor,
  clearLiveTurn,
  updateConversation,
  updateMessageAttachments,
  saveGeneratedImage,
} from "@/lib/db";
import {
  buildSystemPromptParts,
  complete,
  fetchWithRetry,
  fitContextInPlace,
  getContextLimit,
  DEFAULT_MODEL,
  getSettings,
  historyHasMime,
  historyHasPdf,
  keyProblem,
  listModels,
  openRouterHeaders,
  OPENROUTER_BASE,
  resolveAutoModel,
  STYLE_PRESETS,
  toApiMessage,
  type ChatCompletionMessage,
} from "@/lib/openrouter";
import { DOC_MIME, DOCX_MIME, type Attachment, type ToolCall } from "@/lib/types";
import { ARTIFACTS_SYSTEM_PROMPT } from "@/lib/artifact-shared";
import {
  ARTIFACT_READ_TOOL,
  execArtifactRead,
  processAssistantArtifacts,
} from "@/lib/artifacts";
import {
  buildMemoryContext,
  execMemoryTool,
  extractMemories,
  isMemoryTool,
  MEMORY_SYSTEM_PROMPT,
  MEMORY_TOOL_DEFS,
} from "@/lib/memory";
import { ANALYSIS_SYSTEM_PROMPT } from "@/lib/analysis";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { bodyTooLarge, attachmentsProblem, MAX_CONTENT_CHARS } from "@/lib/limits";
import { resolveChatTarget, targetHeaders, type ChatTarget } from "@/lib/providers";
import { applyPromptCache, cacheSessionId, readCacheStats } from "@/lib/prompt-cache";
import { checkBudgets } from "@/lib/workspaces";
import { assembleTools, callTool } from "@/lib/mcp";
import { assembleHttpTools, execHttpTool } from "@/lib/http-tools";
import {
  BUILTIN_TOOL_DEFS,
  execBuiltinTool,
  isBuiltinTool,
  WEB_TOOLS_PROMPT,
} from "@/lib/builtin-tools";
import {
  execPlatformTool,
  isPlatformTool,
  PLATFORM_TOOL_DEFS,
  PLATFORM_TOOLS_PROMPT,
} from "@/lib/platform-tools";
import {
  execRecallTool,
  isRecallTool,
  RECALL_SYSTEM_PROMPT,
  RECALL_TOOL_DEFS,
} from "@/lib/recall";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 6;

// Design-mode only: lets the design model call a dedicated image model to create
// real assets, then embed them by URL — mixing models for the best result.
const DESIGN_IMAGE_TOOL = {
  type: "function" as const,
  function: {
    name: "generate_image",
    description:
      "Generate a real image (photo, illustration, icon, background, hero graphic) with the image model and get back a URL to embed in the design via <img src>. Use this for actual imagery in decks/pages/prototypes instead of placeholder services. Write a vivid, specific prompt including style and aspect.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image." },
      },
      required: ["prompt"],
    },
  },
};

/** Generate an image with the user's image model, store it, return a hosted URL. */
async function generateDesignImage(
  prompt: string,
  userId: string,
  imageModel: string,
  origin: string
): Promise<string> {
  if (!prompt.trim()) return "Error: empty image prompt";
  const res = await fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: await openRouterHeaders(userId),
    body: JSON.stringify({ model: imageModel, prompt }),
  });
  if (!res.ok) return `Error: image generation failed (${res.status})`;
  const data = await res.json();
  const first = (data.data ?? []).find((d: { b64_json?: string }) => d.b64_json) as
    | { b64_json: string; media_type?: string }
    | undefined;
  if (!first) return "Error: the image model returned no image.";
  const id = await saveGeneratedImage(userId, first.media_type || "image/png", first.b64_json);
  return `Image ready. Embed it with this exact URL: ${origin}/img/${id}`;
}

interface ChatRequest {
  conversationId: string;
  /** New user message. Omit when regenerating the last assistant response. */
  content?: string;
  attachments?: Attachment[];
  /** Truncate history from this message (inclusive) before applying content. Used for edit & regenerate. */
  truncateFromMessageId?: string;
  model?: string;
  /** Enable real-time web search with citations for this turn. */
  webSearch?: boolean;
  /** Request extended thinking (reasoning tokens) for this turn. */
  think?: boolean;
  /** Design mode: generate real images with the image model (vs placeholders). */
  designImages?: boolean;
  /** Design mode: which image model to use for generated images (overrides the default). */
  imageModel?: string;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  const body = (await req.json()) as ChatRequest;
  const attProblem = attachmentsProblem(body.attachments);
  if (attProblem) return attProblem;
  if (typeof body.content === "string" && body.content.length > MAX_CONTENT_CHARS) {
    return Response.json({ error: "Message is too long." }, { status: 413 });
  }
  // Workspace spend policy. Checked before any upstream work so a capped
  // workspace fails with an explanation rather than after the money is gone.
  // A user in no workspace, or only uncapped ones, does no extra queries.
  // Fails OPEN. A spend cap that cannot read its own tables must not be the
  // thing that stops people chatting — an over-budget message slipping
  // through is recoverable, an outage on every turn is not.
  try {
    const verdict = checkBudgets(await workspaceBudgetsFor(userId));
    if (!verdict.allowed) {
      return Response.json({ error: verdict.reason }, { status: 402 });
    }
  } catch (e) {
    console.error("[liberde] workspace budget check failed (allowing):", String(e).slice(0, 200));
  }
  const conversation = await getConversation(body.conversationId);
  if (!conversation || (conversation.user_id && conversation.user_id !== userId)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const settings = await getSettings(userId);
  const requestedModel =
    body.model || conversation.model || settings.defaultModel;
  const isExtModel = requestedModel.startsWith("ext:");
  if (!isExtModel) {
    const key = await getApiKey(userId);
    if (!key) {
      return Response.json(
        { error: "No OpenRouter API key configured. Add one in Settings." },
        { status: 400 }
      );
    }
    const prob = keyProblem(key);
    if (prob) return Response.json({ error: prob }, { status: 400 });
  }
  // Auto routing: ONLY when the selected model is the AUTO sentinel. An explicit
  // model bypasses this and resolves exactly as before.
  // eslint-disable-next-line prefer-const -- reassigned on the Auto 404 fallback below
  let { model, routeReason } = await resolveAutoModel(requestedModel, {
    content: body.content ?? "",
    hasImage: body.attachments?.some((a) => a.mime?.startsWith("image/")) ?? false,
    designMode: conversation.mode === "design",
    priorModel: requestedModel === "auto" ? await getLastAssistantModel(conversation.id) : null,
    settings,
    userId,
  });
  let target: ChatTarget;
  try {
    target = await resolveChatTarget(model, userId);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }

  if (!(await tryLockConversation(conversation.id))) {
    return Response.json(
      { error: "A response is already being generated in this conversation." },
      { status: 429 }
    );
  }

  // Everything from here until the stream is handed off can throw (tool
  // assembly, PDF extraction, pre-search). Guard it so the lock is always
  // released on a setup failure — otherwise the conversation stays locked.
  try {
  // `model` is the routed concrete model; the conversation keeps the AUTO
  // sentinel (body.model) so every future turn re-routes.
  if (body.model && body.model !== conversation.model) {
    await updateConversation(conversation.id, { model: body.model });
  }

  if (body.truncateFromMessageId) {
    // ChatGPT-style branching: the replaced tail is kept as a switchable variant,
    // so its artifact versions are kept too.
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
  if (body.content != null) {
    await addMessage(
      conversation.id,
      "user",
      body.content,
      null,
      body.attachments?.length ? body.attachments : null
    );
  }

  const history = await listMessages(conversation.id);
  const tail = history[history.length - 1];
  // Valid continuation points: a fresh user message, or pending tool results
  // (regenerating a final answer after tool calls).
  if (!tail || (tail.role !== "user" && tail.role !== "tool")) {
    await unlockConversation(conversation.id);
    return Response.json({ error: "Nothing to respond to" }, { status: 400 });
  }

  const project = conversation.project_id
    ? await getProject(conversation.project_id)
    : null;
  const lastUserContent =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const systemParts = await buildSystemPromptParts(
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

  // Memory is skipped entirely in temporary chats (nothing is remembered from them).
  const memoryActive = settings.memoryEnabled && !conversation.is_temp;
  // Recall: let the model search the user's own past chats (skipped in temp chats).
  const recallActive = settings.recallEnabled && !conversation.is_temp;

  const designMode = conversation.mode === "design";
  // Design imagery: "new way" = AI-generate assets via the image model (opt-in);
  // "old way" = placeholder image services. Default is the old way.
  // Only offer the generate_image tool when an image model is actually
  // configured — otherwise the model calls a tool that can only fail.
  const imageModel = body.imageModel || settings.imageModel;
  const designImages = designMode && body.designImages === true && !!imageModel;

  const { tools: mcpTools, errors: toolErrors } = await assembleTools(userId);
  // eslint-disable-next-line prefer-const -- re-assembled when create_http_tool adds one mid-turn
  let { defs: httpDefs, names: httpToolNames } = await assembleHttpTools(userId);
  const tools = [
    ...BUILTIN_TOOL_DEFS,
    ...PLATFORM_TOOL_DEFS,
    ARTIFACT_READ_TOOL,
    ...(designImages ? [DESIGN_IMAGE_TOOL] : []),
    ...(memoryActive ? MEMORY_TOOL_DEFS : []),
    ...(recallActive ? RECALL_TOOL_DEFS : []),
    ...httpDefs,
    ...mcpTools,
  ];
  const designDirective =
    designMode
      ? `# Design mode — Liberde Design studio
You are Liberde's Design studio, modeled on Claude Design. You turn requests into polished, INTERACTIVE prototypes: clickable app mockups, PowerPoint-style slide decks, landing pages, dashboards, mini web apps, and interactive diagrams — rendered live on the canvas as a self-contained artifact (a single HTML document with inline CSS/JS). Almost every reply is a visual artifact, not prose.

## 1. Ask first (ONE round), then build
On a NEW design (no artifact exists yet), ALWAYS ask ONE round of focused clarifying questions BEFORE building — even when the user already gave detail (fold their detail in as the pre-selected/default option so answering is fast). Do NOT skip this and start building. Present them as interactive option cards: <liberdeAsk>[{"q":"question?","options":["Option A","Option B"],"multi":false}]</liberdeAsk>. Ask ~5–8 questions, in priority order:
1. Starting point — match an existing brand/design system/reference, or start fresh? (include "Start fresh" as an option)
2. Purpose & audience
3. Visual style / vibe (e.g. Minimal, Bold, Playful, Corporate, Editorial)
4. Color direction (offer a few palettes + "You choose")
5. Scope — decks: how many slides; apps: how many screens; must-have sections
6. A couple of problem-specific questions
Give each 2–4 concrete options (the user can also type their own), and lead with a sensible default. ALWAYS make the LAST item a free-text catch-all with NO options: {"q":"Anything else I should know? (optional)","options":[]} — this renders as an open text box. Keep it to this single round, then build from the answers. SKIP this step entirely ONLY for tweaks/follow-ups on an existing design.

## 2. Build
Build the full self-contained artifact. Make it genuinely beautiful and modern: deliberate type scale, spacing rhythm, a cohesive palette declared as CSS custom properties in :root (so it's trivially tweakable), strong hierarchy, depth, responsive, accessible contrast. Real interactivity — working buttons/tabs/nav, hover/press states, transitions — it must feel like a real working app, not a static mockup. You may use Google Fonts via <link>.

FILL THE VIEWPORT: for full-page designs — apps, dashboards, landing pages, web-app clones, tools — set html,body{margin:0} and make the top-level layout span the whole viewport (width:100%; min-height:100vh), so it fills the canvas edge to edge like a real product. Do NOT wrap the entire UI in a centered fixed max-width card floating on a background — that "small window" look is only appropriate when the design IS deliberately a device/phone mockup or a single centered widget (e.g. a login card). Inner content may still use max-width containers for readability; it's the OUTER shell that must fill the screen.

For IMAGERY: ${
        designImages
          ? "to create custom visuals — hero images, photos, illustrations, icons, backgrounds, slide artwork — ALWAYS call the generate_image tool with a vivid prompt and embed the URL it returns in an <img src=\"…\">. The tool routes to the user's chosen image model, so use it for EVERY generated image — never claim you cannot pick a provider, and never rely on your own native image output. Do this for images that materially improve the design; call it a few times for the key visuals."
          : "use images from images.unsplash.com or picsum.photos for any imagery (there is no image-generation tool in this mode)."
      }

For SLIDE DECKS: emit the artifact as a slides type (<liberdeArtifact type="slides" …>), with each slide as a top-level \`<section class="slide">\` element — this unlocks the built-in deck player (each slide is a FIXED 1920×1080 canvas scaled to fit — design in absolute pixels for it and make every slide's content fit; overflow is clipped), arrow-key/on-screen navigation, print-to-PDF, and PowerPoint (.pptx) export. Put a clear heading (h1/h2) and concise bullet/paragraph content in each slide (one idea per slide) and keep the text as plain static HTML so it stays editable and exports cleanly. Define the theme via CSS custom properties in :root. End each slide with speaker notes — <aside class="notes">1–3 sentences the presenter would say</aside> — hidden on the slide itself, editable in the player's 🗒 notes panel, exported as PowerPoint presenter notes.

## 3. Tweak surgically
When the user asks for a change, edit ONLY what they asked and PRESERVE everything else — layout, spacing, fonts, positions, and colors you weren't asked to touch. Update the CURRENT artifact with a targeted change; never rewrite from scratch or "improve" unrelated parts. Common tweaks: recolor the palette, restyle a single slide/screen, rewrite copy, add/remove a slide, swap an image, change the vibe.

Only reply in plain text for a genuine question that clearly isn't a design request.`
      : "";
  // Active design system: pinned per-conversation; owner or share recipient may
  // apply it. A stale/revoked id degrades to no system rather than failing.
  let designSystemBlock = "";
  if (designMode && conversation.design_system_id) {
    try {
      const ds = await getDesignSystem(conversation.design_system_id);
      if (ds && (await canAccessDesignSystem(ds.id, userId))) {
        designSystemBlock = `# Active design system: ${ds.name}
The user selected this design system for this conversation. Every artifact you build MUST follow it — declare its palette as CSS custom properties in :root, use its fonts (via Google Fonts <link>), spacing rhythm, and component styles throughout. When asking clarifying questions, skip questions the system already answers (colors, fonts, vibe). Before finishing an artifact, re-check it against the system (palette, typography, spacing, components) and fix any drift. If the user explicitly asks to deviate from the system, the user wins.

${ds.spec}`;
      }
    } catch (e) {
      console.error("design system load failed (continuing without):", e);
    }
  }
  const styleDirective = STYLE_PRESETS[settings.responseStyle]?.directive ?? "";
  // Split by cacheability: everything identical on every turn goes in the head
  // (which carries the prompt-cache breakpoint); everything that moves — the
  // date, retrieved project knowledge, saved memories — goes in a tail block
  // placed after the conversation, outside the cached prefix.
  const stableSystemPrompt = [
    designDirective,
    designSystemBlock,
    styleDirective,
    systemParts.stable,
    ARTIFACTS_SYSTEM_PROMPT,
    ANALYSIS_SYSTEM_PROMPT,
    WEB_TOOLS_PROMPT,
    PLATFORM_TOOLS_PROMPT,
    recallActive ? RECALL_SYSTEM_PROMPT : "",
    '# Clarifying\nIf a request is genuinely ambiguous or missing details needed to do it well (especially before substantial work), ask clarifying questions first instead of guessing. When you ask, emit them as an interactive block the interface turns into clickable options: <liberdeAsk>[{"q":"question?","options":["Option A","Option B"],"multi":false}]</liberdeAsk> — 1-3 questions, each with 2-4 concrete options. For simple or clear requests, just answer — do not over-ask.',
    memoryActive ? MEMORY_SYSTEM_PROMPT : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const volatileSystemPrompt = [
    systemParts.volatile,
    memoryActive ? await buildMemoryContext(userId) : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Extract PDF text ourselves for every provider, once, persisted on the
  // attachment. Local pdf.js reads text-layer PDFs that OpenRouter's free
  // file-parser engine returns blank for, and one path means the same result
  // whichever model is selected. Only a PDF we genuinely can't read falls
  // through to the provider-side parser below.
  let pdfNeedsProviderParse = false;
  if (historyHasPdf(history)) {
    // The import can itself throw (pdf.js needs DOM globals at module scope), and
    // a PDF we can't parse must never take down the whole turn — fall through to
    // the provider-side parser instead of 500ing the chat.
    try {
      const { ensurePdfText } = await import("@/lib/pdf");
      pdfNeedsProviderParse = await ensurePdfText(history, updateMessageAttachments);
    } catch (e) {
      console.error("PDF extraction unavailable:", e);
      pdfNeedsProviderParse = true;
    }
  }

  // DOCX is a zip, so it needs the same server-side parse. No provider can read
  // one, so a failure here just means the model is told the file was unreadable.
  if (historyHasMime(history, DOCX_MIME)) {
    try {
      const { ensureDocxText } = await import("@/lib/docx");
      await ensureDocxText(history, updateMessageAttachments);
    } catch (e) {
      console.error("DOCX extraction unavailable:", e);
    }
  }

  // Legacy .doc: OLE2 binary, MHTML web archive, or HTML export — sniffed server-side.
  if (historyHasMime(history, DOC_MIME)) {
    try {
      const { ensureDocText } = await import("@/lib/doc");
      await ensureDocText(history, updateMessageAttachments);
    } catch (e) {
      console.error("DOC extraction unavailable:", e);
    }
  }

  const apiMessages: ChatCompletionMessage[] = [];
  if (stableSystemPrompt) {
    apiMessages.push({ role: "system", content: stableSystemPrompt });
  }
  apiMessages.push(
    ...history.map((m) =>
      toApiMessage(m, { rawPdfFallback: target.isOpenRouter && pdfNeedsProviderParse })
    )
  );
  // Deliberately after the history: this block changes every turn, so anything
  // it preceded could never be served from cache.
  if (volatileSystemPrompt) {
    apiMessages.push({ role: "system", content: volatileSystemPrompt });
  }

  // The 🌐 toggle on external providers: run the search ourselves and inject results.
  const preSearchAnnotations: unknown[] = [];
  let preSearchCost = 0;
  if (body.webSearch && !target.isOpenRouter && body.content) {
    const result = await execBuiltinTool(
      "web_search",
      JSON.stringify({ query: body.content.slice(0, 300) }),
      userId
    );
    if (!result.output.startsWith("Error")) {
      apiMessages.push({
        role: "system",
        content: `Fresh web search results relevant to the user's latest message (cite what you use):\n\n${result.output}`,
      });
      preSearchAnnotations.push(...result.annotations);
      preSearchCost = result.cost ?? 0;
    }
  }

  const needsTitle = conversation.title === "New chat";
  const firstUserContent = history.find((m) => m.role === "user")?.content ?? "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          /* client gone; keep going so results persist */
        }
      };
      if (toolErrors.length) {
        emit({ toolEvent: { status: `Connector issues: ${toolErrors.join("; ")}` } });
      }

      let finalText = "";
      let finalReasoning = "";
      const finalAnnotations: unknown[] = [...preSearchAnnotations];
      const finalImages: string[] = [];
      let useExtReasoning = body.think && !target.isOpenRouter;
      let useTools = tools.length > 0;
      // Set when OpenRouter 402s on pre-authorization (low balance can't cover
      // the model's maximum output reservation) — retry with an affordable cap.
      let maxTokensCap: number | null = null;
      // Last-resort fallback: some models/providers reject optional features
      // (web/pdf plugins, reasoning, tools) with an error that isn't specific
      // enough to pattern-match. When set, we resend a bare request.
      let minimalMode = false;
      // One-shot guard: force a tools-off "produce the artifact now" turn when a
      // (usually weaker) model ends up promising to build something but never
      // emits the artifact block — a common failure in design mode.
      let forcedArtifactDone = false;
  // Auto routing can pick a model this account can't access (needs provider
  // enablement / data policy) → 404. Fall back once to the user's default model
  // (known-good) so an Auto pick never hard-fails on a 404.
  let autoFellBack = false;
      // Don't start the (extra, full) forced-synthesis turn if the request is
      // already close to the function's maxDuration (300s) — being hard-killed
      // mid-synthesis loses the artifact and wedges the conversation lock.
      const turnStart = Date.now();
      const FORCE_SYNTH_DEADLINE_MS = 180_000;
      // Hard turn deadline: a zombie upstream stream (accepted the request,
      // then drips error frames forever — seen with saturated free endpoints)
      // otherwise pins the read loop until Vercel hard-kills the function at
      // maxDuration, which persists nothing and strands the lock. Abort the
      // upstream ourselves with time to spare so partials persist and the
      // lock releases.
      const turnAbort = new AbortController();
      const hardStop = setTimeout(() => turnAbort.abort(), 270_000);
      const turnSignal =
        typeof AbortSignal.any === "function"
          ? AbortSignal.any([req.signal, turnAbort.signal])
          : req.signal;
      let reasoningStartedAt: number | null = null;
      let reasoningEndedAt: number | null = null;
      let totalCost = preSearchCost;
      // Cost attribution: how much of this turn went to web search vs the
      // model itself (surfaced on the Usage page and the message tooltip).
      let searchCost = preSearchCost;
      let pluginResults = 0;
      let totalTokensIn = 0;
      // Of those input tokens, how many came from cache and what OpenRouter
      // says that saved. Without this there is no telling a working cache
      // from one a stray timestamp silently invalidated.
      // Mirror of the reply so far, for a client that reloads mid-turn. Every
      // flush is a database round trip, so it is time-boxed rather than
      // per-token, and failures are swallowed: a cosmetic mirror must never
      // be the thing that kills a turn.
      let liveFlushedAt = 0;
      let liveFlushed = "";
      const LIVE_FLUSH_MS = 900;
      // Flushes are chained rather than fired in parallel: they are called
      // from the token loop without being awaited, and two in flight at once
      // could land out of order and leave the mirror showing older text.
      // Awaiting the chain before the final delete is also what stops a
      // late flush from resurrecting the row after the turn is saved.
      let liveChain: Promise<void> = Promise.resolve();
      const flushLive = (text: string) => {
        if (conversation.is_temp) return;
        if (Date.now() - liveFlushedAt < LIVE_FLUSH_MS || text === liveFlushed) return;
        liveFlushedAt = Date.now();
        liveFlushed = text;
        liveChain = liveChain.then(async () => {
          try {
            await setLiveTurn(conversation.id, text);
          } catch {
            /* the reply itself is unaffected */
          }
        });
      };
      let cachedTokensIn = 0;
      let cacheDiscount = 0;
      let totalTokensOut = 0;

      const finalize = async ({
        errored = false,
        clientGone = false,
      }: { errored?: boolean; clientGone?: boolean } = {}) => {
        clearTimeout(hardStop);
        // External clouds report tokens, not dollars — estimate from configured
        // prices here (not on the happy path only) so aborted/errored turns
        // still record cost and count toward the monthly budget.
        if (!target.isOpenRouter && (totalTokensIn || totalTokensOut)) {
          totalCost +=
            (totalTokensIn * (target.promptPricePerM ?? 0) +
              totalTokensOut * (target.completionPricePerM ?? 0)) /
            1_000_000;
        }
        let savedId: string | null = null;
        let title: string | null = null;
        let memoriesSaved = 0;
        if (finalText.trim() || finalImages.length) {
          let content = finalText;
          if (memoryActive && content.trim()) {
            try {
              const extracted = await extractMemories(content, userId);
              content = extracted.cleaned;
              memoriesSaved = extracted.saved;
            } catch (e) {
              console.error("memory extraction failed:", e);
            }
          }
          const reasoningMs =
            reasoningStartedAt != null
              ? Math.max(0, (reasoningEndedAt ?? Date.now()) - reasoningStartedAt)
              : null;
          // The OpenRouter web plugin bills ~$4 per 1000 results, bundled into
          // the request cost — estimate the search share from returned results.
          if (body.webSearch && target.isOpenRouter && pluginResults > 0) {
            searchCost += Math.min(
              pluginResults * 0.004,
              Math.max(0, totalCost - searchCost)
            );
          }
          const costBreakdown = totalCost
            ? JSON.stringify({
                model: Math.max(0, totalCost - searchCost),
                ...(searchCost > 0 ? { search: Math.min(searchCost, totalCost) } : {}),
              })
            : null;
          const saved = await addMessage(conversation.id, "assistant", content, model, null, {
            reasoning: finalReasoning || null,
            annotations: finalAnnotations.length ? finalAnnotations : null,
            images: finalImages.length ? finalImages : null,
            reasoning_ms: reasoningMs,
            cost: totalCost || null,
            tokens_in: totalTokensIn || null,
            cached_tokens_in: cachedTokensIn || null,
            cache_discount: cacheDiscount || null,
            tokens_out: totalTokensOut || null,
            cost_breakdown: costBreakdown,
            duration_ms: Date.now() - turnStart,
            route_reason: routeReason,
          });
          savedId = saved.id;
          try {
            await processAssistantArtifacts(conversation.id, saved.id, content);
          } catch (e) {
            console.error("artifact processing failed:", e);
          }
          if (!errored && !clientGone && needsTitle && !conversation.is_temp) {
            title = await generateTitle(firstUserContent, content, settings.titleModel, userId);
            if (title) await updateConversation(conversation.id, { title });
          }
        }
        // The saved message supersedes the mirror. Cleared on every path,
        // including errors — a stale buffer would have the next page load
        // replaying a reply that already finished.
        try {
          await liveChain;
          await clearLiveTurn(conversation.id);
        } catch {
          /* the cron-side TTL in the conversation lock covers this */
        }
        // Always send a terminal frame (unless the client is already gone), so
        // the UI never spins forever — success, empty, or hard failure alike.
        if (!clientGone) {
          if (errored && !finalText.trim()) {
            emit({ error: "The model call failed. Please try again." });
          } else {
            emit({ done: true, messageId: savedId, title, memoriesSaved });
          }
        }
        await unlockConversation(conversation.id);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Keep the prompt within the model's context window: trim oldest turns
      // up front so a long conversation doesn't 400 forever. Mid-loop overflow
      // (large tool outputs) is caught and re-trimmed below.
      const contextLimit = await getContextLimit(requestedModel);
      // Some models emit images natively as an output modality (Gemini image,
      // GPT-4o image, etc.) — ask for image output when the model supports it.
      // BUT when the user has opted into design AI-images with a dedicated
      // image model, force imagery through the generate_image tool so THAT
      // model is used — otherwise a chat model that also outputs images would
      // silently make them itself and ignore the chosen image model.
      const outputsImages =
        target.isOpenRouter &&
        !designImages &&
        ((await listModels().catch(() => [])).find((m) => m.id === requestedModel)
          ?.outputsImages ??
          false);
      {
        const { trimmed } = fitContextInPlace(apiMessages, contextLimit);
        if (trimmed) {
          emit({ toolEvent: { status: `Trimmed ${trimmed} older message(s) to fit the context window` } });
        }
      }
      // Anthropic and Qwen bill the whole prompt again every round unless a
      // breakpoint says otherwise. Marked once, after trimming has settled
      // which messages survive and before the tool loop starts adding rounds.
      applyPromptCache(apiMessages, { model: target.bodyModel, isOpenRouter: target.isOpenRouter });

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
          // Wall-clock budget: starting another upstream round too close to the
          // function's maxDuration (300s) risks a hard kill that persists
          // NOTHING — the turn silently vanishes on reload (seen with slow free
          // models + PDFs + multiple tool rounds). Wrap up instead.
          if (round > 0 && Date.now() - turnStart > 200_000) {
            emit({ toolEvent: { status: "Out of time for more steps this turn — wrapping up" } });
            if (!finalText.trim() && !finalImages.length) {
              finalText =
                "I ran out of time this turn (slow model + long inputs) after the tool steps above — their results are saved. Say **continue** to pick up from here, or switch to a faster model and retry.";
            }
            break;
          }
          const reqBody = JSON.stringify({
              model: target.bodyModel,
              messages: apiMessages,
              stream: true,
              temperature: settings.temperature,
              ...(maxTokensCap ? { max_tokens: maxTokensCap } : {}),
              ...(useTools && round < MAX_TOOL_ROUNDS && !minimalMode ? { tools } : {}),
              // Provider-specific extras.
              ...(target.isOpenRouter
                ? {
                    usage: { include: true },
                    session_id: cacheSessionId(conversation.id),
                    ...(outputsImages ? { modalities: ["image", "text"] } : {}),
                    ...(minimalMode
                      ? {}
                      : (() => {
                          const plugins: object[] = [];
                          if (body.webSearch) plugins.push({ id: "web", max_results: 5 });
                          // Only for PDFs local extraction couldn't read — i.e.
                          // no text layer, so the free text-layer engine would
                          // come back blank too and OCR is the only option left.
                          if (pdfNeedsProviderParse) {
                            plugins.push({
                              id: "file-parser",
                              pdf: { engine: "mistral-ocr" },
                            });
                          }
                          return plugins.length ? { plugins } : {};
                        })()),
                    ...(body.think && !minimalMode ? { reasoning: { effort: "medium" } } : {}),
                  }
                : {
                    // Standard OpenAI-dialect equivalents for external clouds.
                    stream_options: { include_usage: true },
                    ...(useExtReasoning && !minimalMode ? { reasoning_effort: "medium" } : {}),
                  }),
            });
          const upstream = await fetchWithRetry(target.url, {
            method: "POST",
            headers: targetHeaders(target, reqBody),
            body: reqBody,
          }, { signal: turnSignal });

          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text();
            // OpenRouter pre-authorizes the model's MAX output length: with a
            // low balance it 402s even though the actual reply would cost
            // pennies ("requested up to 65536 tokens, but can only afford N").
            // Retry once with an affordable max_tokens cap.
            const afford = detail.match(/can only afford (\d+)/i);
            if (upstream.status === 402 && afford && !maxTokensCap) {
              maxTokensCap = Math.max(1024, Math.floor(Number(afford[1]) * 0.9));
              emit({
                toolEvent: {
                  status: `OpenRouter balance is low — capping this reply at ${maxTokensCap.toLocaleString()} tokens so it can run`,
                },
              });
              round--;
              continue;
            }
            if (upstream.status === 402) {
              emit({
                error:
                  "Your OpenRouter balance is too low to reserve this model's output. Top up at openrouter.ai/settings/credits, or switch to a cheaper/free model.",
              });
              break;
            }
            // Models that don't take reasoning_effort get a retry without it.
            if (useExtReasoning && /reasoning/i.test(detail)) {
              useExtReasoning = false;
              round--;
              continue;
            }
            // Some models reject the tools parameter — retry the round without tools.
            if (useTools && /tool/i.test(detail)) {
              useTools = false;
              emit({
                toolEvent: { status: "Model doesn't support tools — continuing without connectors" },
              });
              round--;
              continue;
            }
            // Context-length overflow: trim harder and retry once. Only if the
            // trim actually removed something, else we'd loop forever.
            if (/context|maximum.*token|token.*(exceed|limit)|reduce the length|too long/i.test(detail)) {
              const { trimmed } = fitContextInPlace(apiMessages, contextLimit, 8000);
              if (trimmed) {
                emit({ toolEvent: { status: `Context overflow — trimmed ${trimmed} message(s) and retrying` } });
                round--;
                continue;
              }
            }
            // OpenRouter data-policy / no-endpoints 404 (common with xAI/Grok and
            // other single-provider models) — actionable, not a generic failure.
            if (
              upstream.status === 404 ||
              /no (allowed )?(endpoints|providers)|data policy|privacy settings/i.test(detail)
            ) {
              // Auto routed to a model this account can't access — retry once on
              // the user's default (known-good) model instead of hard-failing.
              const fb =
                settings.defaultModel && settings.defaultModel !== "auto"
                  ? settings.defaultModel
                  : DEFAULT_MODEL;
              if (routeReason && !autoFellBack && fb !== model) {
                autoFellBack = true;
                try {
                  target = await resolveChatTarget(fb, userId);
                  model = fb;
                  // Re-mark for the new model: the fallback may not be a
                  // provider that wants breakpoints at all.
                  applyPromptCache(apiMessages, {
                    model: target.bodyModel,
                    isOpenRouter: target.isOpenRouter,
                  });
                  routeReason = `${routeReason} → fell back (first pick unavailable)`;
                  emit({
                    toolEvent: {
                      status: "Auto's first pick wasn't available on your account — switching to your default model",
                    },
                  });
                  round--;
                  continue;
                } catch {
                  /* fall through to the error below */
                }
              }
              emit({
                error:
                  `This model isn't available for your OpenRouter account (${upstream.status}). ` +
                  `Grok and some other models need their provider enabled and a compatible data policy — ` +
                  `open openrouter.ai/settings/privacy, enable the provider, then try again.`,
              });
              break;
            }
            // Last resort: strip every optional feature and retry once bare. This
            // rescues models that reject plugins/reasoning/tools with a vague error.
            if (!minimalMode && (useTools || body.think || body.webSearch || historyHasPdf(history))) {
              minimalMode = true;
              emit({ toolEvent: { status: "Retrying without optional features (tools/web/reasoning)…" } });
              round--;
              continue;
            }
            emit({ error: `Model error ${upstream.status}: ${detail.slice(0, 500)}` });
            break;
          }

          // Pump one model turn: collect content, reasoning, annotations, tool calls.
          let roundText = "";
          const toolCalls: ToolCall[] = [];
          let lastToolSlot = -1;
          let buffer = "";
          const decoder = new TextDecoder();
          const reader = upstream.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const payload = trimmed.slice(6);
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload);
                const choice = parsed.choices?.[0];
                const delta = choice?.delta?.content;
                if (delta) {
                  if (reasoningStartedAt != null && reasoningEndedAt == null) {
                    reasoningEndedAt = Date.now();
                  }
                  roundText += delta;
                  finalText += delta;
                  emit({ delta });
                  flushLive(finalText);
                }
                // Native image output (Gemini/GPT image models): images arrive
                // on delta.images / message.images as {image_url:{url}}.
                const imgParts =
                  choice?.delta?.images ?? choice?.message?.images;
                if (Array.isArray(imgParts)) {
                  for (const im of imgParts) {
                    const url = im?.image_url?.url ?? im?.url;
                    if (typeof url === "string" && url && !finalImages.includes(url)) {
                      finalImages.push(url);
                      emit({ images: [url] });
                    }
                  }
                }
                const reasoningDelta =
                  choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
                if (typeof reasoningDelta === "string" && reasoningDelta) {
                  if (reasoningStartedAt == null) reasoningStartedAt = Date.now();
                  finalReasoning += reasoningDelta;
                  emit({ reasoning: reasoningDelta });
                }
                const newAnnotations =
                  choice?.delta?.annotations ?? choice?.message?.annotations;
                if (Array.isArray(newAnnotations) && newAnnotations.length) {
                  finalAnnotations.push(...newAnnotations);
                  pluginResults += newAnnotations.length;
                  emit({ annotations: newAnnotations });
                }
                const tcDeltas = choice?.delta?.tool_calls;
                if (Array.isArray(tcDeltas)) {
                  for (const tc of tcDeltas) {
                    // Providers usually stream an index; when absent, a fresh id
                    // starts a new slot (never collapse parallel calls into one).
                    let idx: number;
                    if (typeof tc.index === "number") {
                      idx = tc.index;
                    } else if (tc.id) {
                      const existing = toolCalls.findIndex((t) => t?.id === tc.id);
                      idx = existing !== -1 ? existing : toolCalls.length;
                    } else {
                      idx = lastToolSlot === -1 ? 0 : lastToolSlot;
                    }
                    lastToolSlot = idx;
                    if (!toolCalls[idx]) {
                      toolCalls[idx] = {
                        id: tc.id ?? `call_${idx}`,
                        type: "function",
                        function: { name: "", arguments: "" },
                      };
                    }
                    if (tc.id) toolCalls[idx].id = tc.id;
                    if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                    if (tc.function?.arguments) {
                      toolCalls[idx].function.arguments += tc.function.arguments;
                    }
                  }
                }
                if (parsed.usage) {
                  totalCost += Number(parsed.usage.cost) || 0;
                  {
                    const c = readCacheStats(parsed.usage);
                    cachedTokensIn += c.cachedTokens;
                    cacheDiscount += c.discount;
                  }
                  totalTokensIn += Number(parsed.usage.prompt_tokens) || 0;
                  totalTokensOut += Number(parsed.usage.completion_tokens) || 0;
                }
                if (parsed.error) {
                  emit({ error: parsed.error.message ?? String(parsed.error) });
                }
              } catch {
                /* malformed keep-alive line */
              }
            }
          }

          const calls = toolCalls.filter(Boolean);
          if (calls.length === 0 || round >= MAX_TOOL_ROUNDS) {
            // Rescue (DESIGN MODE ONLY): a design turn is expected to end in an
            // artifact; if the model narrated "building it now…" but never emitted
            // the block, force one tools-off turn to produce it. This NEVER runs in
            // normal chat — there it wrongly discarded good answers (e.g. "Here's
            // the comparison: …") and replaced them with a confabulated
            // "what artifact do you want?" turn.
            const noArtifact = !/<liberdeArtifact/i.test(finalText);
            // If the model asked clarifying questions (ask-first flow), it is NOT
            // trying to build yet — never override that.
            const askedQuestions = /<liberdeAsk/i.test(finalText);
            if (
              !forcedArtifactDone &&
              useTools &&
              !minimalMode &&
              noArtifact &&
              !askedQuestions &&
              Date.now() - turnStart < FORCE_SYNTH_DEADLINE_MS &&
              // Only when there's no real answer yet (short narration), and only
              // in the design workspace.
              finalText.trim().length < 600 &&
              designMode
            ) {
              forcedArtifactDone = true;
              emit({ toolEvent: { status: "Producing the artifact…" } });
              apiMessages.push({ role: "assistant", content: finalText || null });
              apiMessages.push({
                role: "user",
                content:
                  "Output the COMPLETE artifact right now as a single <liberdeArtifact …>…</liberdeArtifact> block, written directly in your reply. Do NOT call any tools, do NOT read anything, and do NOT say you will build it or that here it is — just write the full artifact content now. Artifacts are created ONLY by writing this block in your message; no tool creates them.",
              });
              finalText = "";
              const fbBody = JSON.stringify({
                model: target.bodyModel,
                messages: apiMessages,
                stream: true,
                temperature: settings.temperature,
                ...(target.isOpenRouter
                  ? { usage: { include: true }, session_id: cacheSessionId(conversation.id) }
                  : { stream_options: { include_usage: true } }),
              });
              try {
                const fbRes = await fetchWithRetry(
                  target.url,
                  { method: "POST", headers: targetHeaders(target, fbBody), body: fbBody },
                  { signal: turnSignal }
                );
                if (fbRes.ok && fbRes.body) {
                  const rd = fbRes.body.getReader();
                  const dec = new TextDecoder();
                  let fb = "";
                  for (;;) {
                    const { done, value } = await rd.read();
                    if (done) break;
                    fb += dec.decode(value, { stream: true });
                    const fbLines = fb.split("\n");
                    fb = fbLines.pop() ?? "";
                    for (const l of fbLines) {
                      const t = l.trim();
                      if (!t.startsWith("data: ")) continue;
                      const p = t.slice(6);
                      if (p === "[DONE]") continue;
                      try {
                        const parsed = JSON.parse(p);
                        const d = parsed.choices?.[0]?.delta?.content;
                        if (d) {
                          finalText += d;
                          emit({ delta: d });
                          flushLive(finalText);
                        }
                        if (parsed.usage) {
                          totalCost += Number(parsed.usage.cost) || 0;
                          {
                            const c = readCacheStats(parsed.usage);
                            cachedTokensIn += c.cachedTokens;
                            cacheDiscount += c.discount;
                          }
                          totalTokensIn += Number(parsed.usage.prompt_tokens) || 0;
                          totalTokensOut += Number(parsed.usage.completion_tokens) || 0;
                        }
                      } catch {
                        /* keep-alive */
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("forced artifact synthesis failed:", e);
              }
            }
            await finalize();
            return;
          }

          // Persist this intermediate assistant turn, then run the tools.
          if (roundText.trim() || calls.length) {
            await addMessage(conversation.id, "assistant", roundText, model, null, {
              tool_calls: calls,
            });
            // Reset accumulated text: it's stored on the intermediate message.
            finalText = "";
            emit({ intermediate: true });
          }
          apiMessages.push({
            role: "assistant",
            content: roundText || null,
            tool_calls: calls,
          });

          for (const call of calls) {
            emit({ toolEvent: { status: `${toolLabel(call)}…` } });
            let output: string;
            if (call.function.name === "generate_image") {
              // Handle by NAME (not gated on designImages) so a stray call when
              // the tool isn't offered returns a helpful message instead of
              // falling through to the MCP path ("no connected server…").
              if (!designImages) {
                output =
                  "Image generation is not enabled for this chat, so there is no generate_image tool. Do NOT call it again — instead reference stock photos directly in the artifact via https://images.unsplash.com or https://picsum.photos URLs.";
              } else {
                let p = "";
                try {
                  p = String(JSON.parse(call.function.arguments || "{}").prompt ?? "");
                } catch {
                  /* bad args */
                }
                output = await generateDesignImage(
                  p,
                  userId,
                  imageModel,
                  req.nextUrl.origin
                );
              }
            } else if (call.function.name === "artifact_read") {
              output = await execArtifactRead(conversation.id, call.function.arguments);
            } else if (/^(liberde_?run|run_?(js|javascript|code|python)|code_?(execution|interpreter)|execute_?(code|javascript))$/i.test(call.function.name)) {
              // The analysis tool is a <liberdeRun>…</liberdeRun> TAG the client
              // runs in a browser sandbox — NOT a callable function. Weaker
              // models sometimes invoke it as a tool; steer them to the tag
              // instead of dead-ending on "no connected server provides…".
              output =
                "There is no runnable function for code — the analysis tool works by writing a <liberdeRun>…</liberdeRun> block directly in your reply (JavaScript, runs in the browser sandbox, result comes back automatically). Do NOT call a tool for this. Put your code inside <liberdeRun></liberdeRun> in your next message instead.";
            } else if (isMemoryTool(call.function.name)) {
              output = await execMemoryTool(call.function.name, call.function.arguments, userId);
            } else if (isRecallTool(call.function.name)) {
              output = await execRecallTool(call.function.name, call.function.arguments, userId);
            } else if (isPlatformTool(call.function.name)) {
              const result = await execPlatformTool(
                call.function.name,
                call.function.arguments,
                userId,
                req.nextUrl.origin
              );
              output = result.output;
              // A connector/skill was added: rebuild the tool list in place so
              // the model can call the new tools in this same conversation turn.
              if (result.toolsChanged) {
                const { tools: refreshedMcp } = await assembleTools(userId);
                const refreshedHttp = await assembleHttpTools(userId);
                httpDefs = refreshedHttp.defs;
                httpToolNames = refreshedHttp.names;
                tools.length = 0;
                tools.push(
                  ...BUILTIN_TOOL_DEFS,
                  ...PLATFORM_TOOL_DEFS,
                  ARTIFACT_READ_TOOL,
                  ...(designImages ? [DESIGN_IMAGE_TOOL] : []),
                  ...(memoryActive ? MEMORY_TOOL_DEFS : []),
                  ...(recallActive ? RECALL_TOOL_DEFS : []),
                  ...httpDefs,
                  ...refreshedMcp
                );
              }
            } else if (isBuiltinTool(call.function.name)) {
              const result = await execBuiltinTool(
                call.function.name,
                call.function.arguments,
                userId
              );
              output = result.output;
              totalCost += result.cost ?? 0;
              // Builtin tools that bill are the web tools — attribute to search.
              searchCost += result.cost ?? 0;
              if (result.annotations.length) {
                finalAnnotations.push(...result.annotations);
                emit({ annotations: result.annotations });
              }
            } else if (httpToolNames.has(call.function.name)) {
              output = await execHttpTool(call.function.name, call.function.arguments, userId);
            } else {
              // Origin lets an image returned by an MCP tool be banked and
              // handed back as a URL the reply can actually render.
              output = await callTool(
                call.function.name,
                call.function.arguments,
                userId,
                req.nextUrl.origin
              );
            }
            await addMessage(conversation.id, "tool", output, null, null, {
              tool_call_id: call.id,
            });
            apiMessages.push({ role: "tool", tool_call_id: call.id, content: output });
            emit({
              toolEvent: {
                status: output.startsWith("Error")
                  ? `${toolLabel(call)} failed — ${output.slice(0, 120)}`
                  : `${toolLabel(call)} ✓`,
              },
            });
            if (output.startsWith("Error")) {
              console.error(`[tool ${call.function.name}] ${output.slice(0, 300)}`);
            }
          }
        }
        await finalize();
      } catch (e) {
        // Persist whatever we have. Distinguish a client disconnect (nobody to
        // notify) and our own turn deadline (persist a friendly note, no error)
        // from a real upstream/tool failure (surface a terminal error).
        const clientGone = req.signal.aborted;
        const deadline = turnAbort.signal.aborted && !clientGone;
        if (deadline && !finalText.trim() && !finalImages.length) {
          finalText =
            "I ran out of time this turn — the steps above are saved. Say **continue** to pick up from here, or switch to a faster model and retry.";
        }
        if (!clientGone && !deadline) console.error("chat stream failed:", e);
        await finalize({ errored: !clientGone && !deadline, clientGone });
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
  } catch (e) {
    await unlockConversation(conversation.id);
    console.error("chat setup failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to start generation" },
      { status: 500 }
    );
  }
}

function toolLabel(call: ToolCall): string {
  const name = call.function.name;
  try {
    const args = JSON.parse(call.function.arguments || "{}");
    if (name === "web_search") return `Searching the web: ${args.query}`;
    if (name === "fetch_page") return `Reading ${args.url}`;
    if (name === "connect_mcp_server") return `Connecting MCP server: ${args.name ?? args.url ?? ""}`;
    if (name === "create_skill") return `Saving skill: ${args.name ?? ""}`;
    if (name === "list_connections") return "Checking connected servers & skills";
  } catch {
    /* fall through to generic label */
  }
  if (name.startsWith("skill__")) return "Loading skill";
  if (name.startsWith("memory_")) return "Updating memory";
  return `Using ${name.replace(/__/g, ": ")}`;
}

async function generateTitle(
  userText: string,
  assistantText: string,
  titleModel: string,
  userId?: string
): Promise<string | null> {
  try {
    const raw = await complete(
      titleModel,
      [
        {
          role: "user",
          content: `Write a title (2-6 words, no quotes, no trailing punctuation) summarizing this conversation.\n\nUser: ${userText.slice(0, 1500)}\n\nAssistant: ${assistantText.slice(0, 1500)}`,
        },
      ],
      { temperature: 0.3, max_tokens: 30 },
      userId
    );
    const title = raw.replaceAll('"', "").replace(/\.$/, "").trim();
    return title ? title.slice(0, 80) : null;
  } catch {
    return null;
  }
}
