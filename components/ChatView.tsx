"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AppSettings,
  Attachment,
  Conversation,
  DesignSystem,
  Message,
  ModelInfo,
  Project,
} from "@/lib/types";
import { DOC_MIME, DOCX_MIME } from "@/lib/types";
import {
  api,
  fileToUploadAttachment,
  streamAgent,
  streamChat,
  streamResearch,
} from "@/lib/client";
import { toast, notifyDone, ensureNotifyPermission } from "@/lib/ui";
import { estimateWh, co2Grams, fmtWh, fmtCo2, ecoEquivalence } from "@/lib/eco";
import Markdown, { type CodePreview } from "./Markdown";
import Icon from "./Icon";
import ModelPicker from "./ModelPicker";
import ModelAdvisor from "./ModelAdvisor";
import ComparePanel from "./ComparePanel";
import DesignSystemChip from "./DesignSystemChip";
import ArtifactPanel, {
  typeIcon,
  type ArtifactWithVersions,
  type PanelContent,
} from "./ArtifactPanel";
import {
  splitContentSegments,
  type ArtifactRecord,
  type ArtifactType,
  type ParsedBlock,
} from "@/lib/artifact-shared";
import { extractRunBlocks, formatRunResult, parseRunResult } from "@/lib/analysis";
import { runJs, runPython, type SandboxFile } from "@/lib/sandbox";

interface Props {
  conversationId: string | null;
  models: ModelInfo[];
  settings: AppSettings | null;
  projects: Project[];
  onConversationCreated: (c: Conversation) => void;
  onConversationsChanged: () => void;
  /** Open the sidebar (mobile hamburger). */
  onOpenSidebar?: () => void;
  /** Signed-in user's name, for the personalized welcome greeting. */
  userName?: string;
  /** "chat" (default) or "design" — scopes new conversations to a workspace. */
  mode?: string;
}

/** An agent as the chat surface needs it — see Settings → Agents. */
interface ChatAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  icon: string;
}

export default function ChatView({
  conversationId,
  models,
  settings,
  projects,
  onConversationCreated,
  onConversationsChanged,
  onOpenSidebar,
  userName,
  mode = "chat",
}: Props) {
  const [convId, setConvId] = useState(conversationId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamText, setStreamText] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  // FLASH-FIX: mirrors of the stream buffers, readable inside the onDone closure
  // (which has stale state). Used to swap the live overlay for a real message
  // atomically at stream end — no blank gap / re-parse flash. Back out: delete
  // these two refs and revert the onDelta/onReasoning/onDone FLASH-FIX blocks.
  const streamTextRef = useRef("");
  const streamReasoningRef = useRef("");
  const [isStreaming, setIsStreaming] = useState(false);
  // A response is generating server-side but this client isn't attached to the
  // SSE stream (e.g. after a reload or on another device) — show a working
  // indicator and poll until it lands, so the result appears without a refresh.
  const [bgWorking, setBgWorking] = useState(false);
  // Partial text of that reply, mirrored server-side. Lets a reload pick the
  // answer up mid-sentence rather than watching a spinner until it lands.
  const [bgPartial, setBgPartial] = useState("");
  // Files the analysis tool wrote to /out. Held in state rather than saved:
  // they are a by-product of a turn, and persisting every intermediate chart
  // would fill the database with things nobody asked to keep.
  const [runFiles, setRunFiles] = useState<SandboxFile[]>([]);
  const isStreamingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [think, setThink] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [research, setResearch] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [designImages, setDesignImages] = useState(false);
  const [designImageModel, setDesignImageModel] = useState("");
  const [researchStatuses, setResearchStatuses] = useState<string[]>([]);
  const [voiceMode, setVoiceMode] = useState<"off" | "listening" | "speaking" | "idle">(
    "off"
  );
  const voiceRecognitionRef = useRef<MinimalRecognition | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const [memoryToast, setMemoryToast] = useState(false);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [compareFor, setCompareFor] = useState<{
    messageId: string;
    question: string;
  } | null>(null);
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  // The agent a not-yet-created chat will start as. It becomes the
  // conversation's agent_id at creation; after that the conversation owns it.
  const [pendingAgent, setPendingAgent] = useState<ChatAgent | null>(null);
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  const designSystemsRef = useRef<DesignSystem[]>([]);
  const dsDefaultApplied = useRef(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [artifacts, setArtifacts] = useState<ArtifactWithVersions[]>([]);
  const [branches, setBranches] = useState<
    { id: string; anchor_id: string; preview: string }[]
  >([]);
  const [panel, setPanel] = useState<PanelContent | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const convIdRef = useRef(convId);
  convIdRef.current = convId;
  const streamingIdentifierRef = useRef<string | null>(null);
  const autoRunsRef = useRef(0);
  const startStreamRef = useRef<
    | ((body: {
        conversationId: string;
        content?: string;
        attachments?: Attachment[];
        truncateFromMessageId?: string;
        model?: string;
        webSearch?: boolean;
        think?: boolean;
      }) => void)
    | null
  >(null);

  const loadArtifacts = useCallback(async (id: string) => {
    try {
      const list = await api<ArtifactWithVersions[]>(
        `/api/conversations/${id}/artifacts`
      );
      if (convIdRef.current === id) setArtifacts(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const stopBgPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBgWorking(false);
  }, []);

  // Poll a conversation that's generating server-side until it finishes (or a
  // new message lands), so the result shows up without a manual refresh.
  const startBgPoll = useCallback(
    (id: string, baseline: number) => {
      if (pollRef.current) clearInterval(pollRef.current);
      let base = baseline;
      pollRef.current = setInterval(async () => {
        if (convIdRef.current !== id || isStreamingRef.current) {
          stopBgPoll();
          return;
        }
        try {
          const d = await api<
            Conversation & { messages: Message[]; generating?: boolean; live?: string | null }
          >(`/api/conversations/${id}`);
          if (convIdRef.current !== id) return;
          const grew = (d.messages?.length ?? 0) > base;
          if (grew) {
            setMessages(d.messages);
            setConversation(d);
            base = d.messages.length;
            loadArtifacts(id);
            // The saved message now carries this text; keeping the mirror
            // would render it twice.
            setBgPartial("");
          } else {
            setBgPartial(d.live ?? "");
          }
          if (!d.generating) {
            setBgPartial("");
            stopBgPoll();
          }
        } catch {
          /* transient; keep polling */
        }
      }, 2500);
    },
    [loadArtifacts, stopBgPoll]
  );

  const loadConversation = useCallback(
    async (id: string) => {
      const data = await api<
        Conversation & { messages: Message[]; generating?: boolean; live?: string | null }
      >(`/api/conversations/${id}`);
      if (convIdRef.current !== id) return [];
      setConversation(data);
      setMessages(data.messages);
      setModel(data.model);
      setDesignSystemId(data.design_system_id ?? null);
      loadArtifacts(id);
      // If a response is being generated but we're not the streaming client,
      // surface a working indicator and poll for the result.
      if (data.generating && !isStreamingRef.current) {
        setBgWorking(true);
        setBgPartial(data.live ?? "");
        startBgPoll(id, data.messages.length);
      } else {
        setBgPartial("");
        stopBgPoll();
      }
      api<{ id: string; anchor_id: string; preview: string }[]>(
        `/api/conversations/${id}/branches`
      )
        .then((b) => {
          if (convIdRef.current === id) setBranches(b);
        })
        .catch(() => {});
      return data.messages;
    },
    [loadArtifacts, startBgPoll, stopBgPoll]
  );

  // Keep a ref of the streaming flag for use inside intervals/callbacks, and
  // stop background polling the moment this client starts streaming itself.
  useEffect(() => {
    isStreamingRef.current = isStreaming;
    if (isStreaming) stopBgPoll();
  }, [isStreaming, stopBgPoll]);

  // Design systems: load the picker list in design mode; a brand-new design
  // starts on the user's default system (existing conversations keep their
  // stored choice, loaded in loadConversation).
  const loadDesignSystems = useCallback((applyDefault: boolean) => {
    api<DesignSystem[]>("/api/design-systems")
      .then((list) => {
        setDesignSystems(list);
        designSystemsRef.current = list;
        if (applyDefault && !convIdRef.current && !dsDefaultApplied.current) {
          dsDefaultApplied.current = true;
          const def = list.find((s) => s.is_default);
          if (def) setDesignSystemId((cur) => cur ?? def.id);
        }
      })
      .catch(() => {});
  }, []);

  // Agents are a small, rarely-changing list, so one load per mount is enough.
  useEffect(() => {
    api<ChatAgent[]>("/api/agents")
      .then(setAgents)
      .catch(() => {
        /* an agentless install is the normal case */
      });
  }, []);

  useEffect(() => {
    if (mode !== "design") return;
    loadDesignSystems(true);
  }, [mode, loadDesignSystems]);

  // Refetch when the Settings dialog adds/edits/removes a system, so a system
  // created from the picker's "+ New…" appears in the dropdown without a reload.
  useEffect(() => {
    const onChanged = () => loadDesignSystems(false);
    window.addEventListener("liberde:design-systems-changed", onChanged);
    return () => window.removeEventListener("liberde:design-systems-changed", onChanged);
  }, [loadDesignSystems]);

  // Clean up the poll on unmount.
  useEffect(() => () => stopBgPoll(), [stopBgPoll]);

  const switchBranch = useCallback(
    async (branchId: string) => {
      if (!convIdRef.current) return;
      const id = convIdRef.current;
      await api(`/api/conversations/${id}/branches`, {
        method: "POST",
        body: JSON.stringify({ branchId }),
      });
      await loadConversation(id);
    },
    [loadConversation]
  );

  // React to sidebar navigation without losing an in-flight stream on self-created chats.
  useEffect(() => {
    if (conversationId === convIdRef.current) return;
    abortRef.current?.();
    abortRef.current = null;
    stopBgPoll();
    setIsStreaming(false);
    setStreamText("");
    setError(null);
    setEditingId(null);
    setPanel(null);
    setArtifacts([]);
    setBranches([]);
    setStreamReasoning("");
    setShareUrl(null);
    setConvId(conversationId);
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setConversation(null);
      setMessages([]);
      setModel("");
      // A fresh design starts back on the user's default design system.
      const def = designSystemsRef.current.find((s) => s.is_default);
      setDesignSystemId(def ? def.id : null);
    }
  }, [conversationId, loadConversation, stopBgPoll]);

  useEffect(() => {
    if (convId) loadConversation(convId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevDefaultRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    if (!model) {
      setModel(settings.defaultModel);
    } else if (
      prevDefaultRef.current &&
      prevDefaultRef.current !== settings.defaultModel &&
      !convIdRef.current
    ) {
      // Default changed mid-session: chats that haven't started yet follow it.
      setModel(settings.defaultModel);
    }
    prevDefaultRef.current = settings.defaultModel;
  }, [settings, model]);

  // Follow the stream, but never yank the view away from someone who scrolled
  // up to re-read. `stickToBottom` latches false the moment they leave the
  // bottom and latches true again when they come back, so the thread pins
  // itself only while they are actually watching the end of it.
  const stickToBottom = useRef(true);
  const onThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    // Instant while tokens land: smooth scrolling cannot keep up with a stream
    // and turns into visible lag. Smooth only for the discrete jumps between
    // turns, which is where it reads as polish.
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? "auto" : "smooth" });
  }, [messages, streamText, isStreaming]);

  // A new conversation always starts pinned, whatever the last one was doing.
  useEffect(() => {
    stickToBottom.current = true;
  }, [conversation?.id]);

  // While streaming, mirror an in-progress artifact into the side panel live.
  useEffect(() => {
    if (!streamText) return;
    const segments = splitContentSegments(streamText);
    const live = segments.find((s) => s.kind === "streaming-artifact");
    if (live?.partial) {
      streamingIdentifierRef.current = live.partial.identifier || null;
      setPanel({
        kind: "streaming",
        title: live.partial.title || live.partial.identifier || "Artifact",
        type: (live.partial.type as ArtifactType) || null,
        content: live.partial.content,
      });
    }
  }, [streamText]);

  // ---- Voice conversation mode: listen → send → speak reply → listen again ----
  const sendRef = useRef<((text: string, attachments: Attachment[]) => void) | null>(null);

  // A message typed while a reply is still streaming. Pressing Enter mid-stream
  // used to be a silent no-op — the text stayed in the box with nothing to
  // explain why nothing happened. Holding it and sending it when the turn ends
  // is what every other chat app does, and it costs nothing on the server.
  const [queued, setQueued] = useState<{ text: string; attachments: Attachment[] } | null>(
    null
  );

  const queueMessage = useCallback((text: string, attachments: Attachment[]) => {
    // A second thought appends rather than replaces: overwriting would throw
    // away something the user already typed and watched disappear.
    setQueued((q) =>
      q
        ? { text: q.text + "\n\n" + text, attachments: [...q.attachments, ...attachments] }
        : { text, attachments }
    );
  }, []);

  useEffect(() => {
    if (isStreaming || !queued) return;
    const pending = queued;
    setQueued(null);
    sendRef.current?.(pending.text, pending.attachments);
  }, [isStreaming, queued]);

  // A queued message belongs to the thread it was typed in.
  useEffect(() => {
    setQueued(null);
    setRunFiles([]);
  }, [conversation?.id]);

  const startVoiceListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      toast("Voice conversations aren't supported in this browser.", "error");
      setVoiceMode("off");
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
      }
      const text = transcript.trim();
      if (text) {
        setVoiceMode("idle");
        sendRef.current?.(text, []);
      }
    };
    rec.onend = () => {
      // If nothing was captured, keep listening (unless the user turned it off).
      setVoiceMode((v) => (v === "listening" ? (rec.start(), "listening") : v));
    };
    rec.onerror = () => setVoiceMode((v) => (v === "listening" ? "idle" : v));
    voiceRecognitionRef.current = rec;
    setVoiceMode("listening");
    rec.start();
  }, []);

  const stopVoiceMode = useCallback(() => {
    setVoiceMode("off");
    voiceRecognitionRef.current?.stop();
    voiceRecognitionRef.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);

  // Speak new assistant replies while voice mode is active, then resume listening.
  useEffect(() => {
    if (voiceMode === "off" || voiceMode === "listening" || isStreaming) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    if (typeof speechSynthesis === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(stripForSpeech(last.content));
    setVoiceMode("speaking");
    const resume = () =>
      setVoiceMode((v) => {
        if (v === "off") return v;
        startVoiceListening();
        return "listening";
      });
    utterance.onend = resume;
    utterance.onerror = resume;
    speechSynthesis.speak(utterance);
  }, [voiceMode, isStreaming, messages, startVoiceListening]);

  const openArtifact = useCallback(
    (identifier: string, list: ArtifactWithVersions[], version?: number) => {
      const artifact = list.find((a) => a.identifier === identifier);
      if (artifact) setPanel({ kind: "artifact", artifact, version });
    },
    []
  );

  const openCodePreview = useCallback((p: CodePreview) => {
    const lang = p.lang.toLowerCase();
    const type: ArtifactType =
      lang === "html" ? "html" : lang === "svg" ? "svg" : lang === "mermaid" ? "mermaid" : "code";
    setPanel({
      kind: "ephemeral",
      title: p.title,
      type,
      language: type === "code" ? p.lang || null : null,
      content: p.code,
    });
  }, []);

  const handleRecordUpdated = useCallback((record: ArtifactRecord) => {
    setArtifacts((prev) =>
      prev.map((a) => (a.id === record.id ? { ...a, ...record } : a))
    );
    setPanel((p) =>
      p?.kind === "artifact" && p.artifact.id === record.id
        ? { ...p, artifact: { ...p.artifact, ...record } }
        : p
    );
  }, []);

  const startStream = useCallback(
    (body: {
      conversationId: string;
      content?: string;
      attachments?: Attachment[];
      truncateFromMessageId?: string;
      model?: string;
      webSearch?: boolean;
      think?: boolean;
      designImages?: boolean;
      imageModel?: string;
    }) => {
      setError(null);
      setIsStreaming(true);
      setStreamText("");
      setStreamReasoning("");
      streamTextRef.current = ""; // FLASH-FIX
      streamReasoningRef.current = ""; // FLASH-FIX
      streamingIdentifierRef.current = null;
      abortRef.current = streamChat(body, {
        onDelta: (d) => {
          streamTextRef.current += d; // FLASH-FIX
          setStreamText((t) => t + d);
        },
        onReasoning: (d) => {
          streamReasoningRef.current += d; // FLASH-FIX
          setStreamReasoning((t) => t + d);
        },
        onToolEvent: (s) => setResearchStatuses((prev) => [...prev.slice(-11), s]),
        onDone: async (messageId, title, memoriesSaved, aborted) => {
          setResearchStatuses([]);
          if (!aborted) notifyDone("Liberde", "Your response is ready");
          if (memoriesSaved) {
            setMemoryToast(true);
            setTimeout(() => setMemoryToast(false), 4000);
          }
          abortRef.current = null;
          // FLASH-FIX: swap the live stream overlay for a real list message in ONE
          // render, using the SAME id the server just persisted. loadConversation
          // then reconciles that message in place (same key) instead of leaving a
          // blank gap during the refetch or re-mounting/re-parsing it. Back out:
          // restore this block to the original 4 lines:
          //   setIsStreaming(false); setStreamText(""); setStreamReasoning("");
          const finalContent = streamTextRef.current;
          const finalReasoning = streamReasoningRef.current;
          if (!aborted && messageId && (finalContent || finalReasoning)) {
            setMessages((m) =>
              m.some((x) => x.id === messageId)
                ? m
                : [
                    ...m,
                    {
                      id: messageId,
                      conversation_id: body.conversationId,
                      role: "assistant",
                      content: finalContent,
                      reasoning: finalReasoning || null,
                      model: body.model && body.model !== "auto" ? body.model : null,
                      attachments: null,
                      created_at: Date.now(),
                    },
                  ]
            );
          }
          setIsStreaming(false);
          setStreamText("");
          streamTextRef.current = "";
          setStreamReasoning("");
          streamReasoningRef.current = "";
          if (convIdRef.current === body.conversationId) {
            const fresh = await loadConversation(body.conversationId);
            const list = await loadArtifacts(body.conversationId);
            // If we were live-streaming an artifact, hand the panel the saved record.
            const streamedId = streamingIdentifierRef.current;
            streamingIdentifierRef.current = null;
            setPanel((p) => {
              if (p?.kind !== "streaming") return p;
              const artifact = streamedId
                ? list.find((a) => a.identifier === streamedId)
                : list[list.length - 1];
              return artifact ? { kind: "artifact", artifact } : null;
            });

            // Analysis tool loop: execute emitted JS, feed the output back, continue.
            // Never relaunch after a user abort — Stop must mean stop.
            const last = fresh[fresh.length - 1];
            if (!aborted && last?.role === "assistant") {
              const runBlocks = extractRunBlocks(last.content);
              if (runBlocks.length > 0 && autoRunsRef.current < 4) {
                autoRunsRef.current++;
                const outputs: string[] = [];
                const produced: SandboxFile[] = [];
                // Python gets the conversation's attachments as real files in
                // /data, which is the whole point of it — a model should read
                // the spreadsheet rather than ask the user to paste it.
                const attached = conversationFiles(fresh);
                for (const block of runBlocks) {
                  if (block.lang === "python") {
                    const r = await runPython(block.code, {
                      files: attached,
                      kernelKey: body.conversationId,
                    });
                    outputs.push(r.output);
                    produced.push(...r.files);
                  } else {
                    outputs.push(await runJs(block.code));
                  }
                }
                if (produced.length) {
                  setRunFiles((prev) => [...prev, ...produced]);
                  outputs.push(
                    "Files written to /out and offered to the user: " +
                      produced.map((fl) => fl.name).join(", ")
                  );
                }
                startStreamRef.current?.({
                  conversationId: body.conversationId,
                  content: formatRunResult(outputs.join("\n---\n")),
                  model: body.model,
                  webSearch: body.webSearch,
                  think: body.think,
                });
                return;
              }
              autoRunsRef.current = 0;
            }
          }
          if (title) onConversationsChanged();
        },
        onError: (msg) => {
          abortRef.current = null;
          setIsStreaming(false);
          setResearchStatuses([]);
          setError(msg);
          if (convIdRef.current === body.conversationId) {
            loadConversation(body.conversationId);
          }
        },
      });
    },
    [loadConversation, loadArtifacts, onConversationsChanged]
  );
  startStreamRef.current = startStream;

  const [tempMode, setTempMode] = useState(false);

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      autoRunsRef.current = 0;
      ensureNotifyPermission();
      let id = convId;
      if (!id) {
        const conv = await api<Conversation>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({
            model,
            temp: tempMode,
            mode,
            ...(mode === "design" && designSystemId ? { designSystemId } : {}),
            ...(pendingAgent ? { agentId: pendingAgent.id } : {}),
          }),
        });
        id = conv.id;
        setConvId(id);
        setConversation(conv);
        onConversationCreated(conv);
      }

      if (research || agentMode) {
        setMessages((m) => [
          ...m,
          {
            id: `pending-${Date.now()}`,
            conversation_id: id!,
            role: "user",
            content: text,
            model: null,
            attachments: null,
            created_at: Date.now(),
          },
        ]);
        setError(null);
        setIsStreaming(true);
        setStreamText("");
        setResearchStatuses([]);
        const pipelineCallbacks = {
          onStatus: (s: string) => setResearchStatuses((prev) => [...prev, s]),
          onDelta: (d: string) => setStreamText((t) => t + d),
          onDone: async () => {
            abortRef.current = null;
            setIsStreaming(false);
            setStreamText("");
            setResearchStatuses([]);
            notifyDone("Liberde", agentMode ? "Your plan finished" : "Your research is ready");
            if (convIdRef.current === id) await loadConversation(id!);
            onConversationsChanged();
          },
          onError: (msg: string) => {
            abortRef.current = null;
            setIsStreaming(false);
            setResearchStatuses([]);
            setError(msg);
            if (convIdRef.current === id) loadConversation(id!);
          },
        };
        abortRef.current = agentMode
          ? streamAgent(
              { conversationId: id!, goal: text, model },
              pipelineCallbacks
            )
          : streamResearch(
              { conversationId: id!, query: text, model },
              pipelineCallbacks
            );
        return;
      }

      if (imageMode) {
        setMessages((m) => [
          ...m,
          {
            id: `pending-${Date.now()}`,
            conversation_id: id!,
            role: "user",
            content: text,
            model: null,
            attachments: null,
            created_at: Date.now(),
          },
        ]);
        setError(null);
        setIsStreaming(true);
        try {
          await api("/api/image-gen", {
            method: "POST",
            body: JSON.stringify({ conversationId: id, prompt: text }),
          });
          await loadConversation(id!);
          onConversationsChanged();
        } catch (e) {
          if (convIdRef.current === id) {
            setError(String((e as Error).message ?? e));
            await loadConversation(id!);
          }
        } finally {
          setIsStreaming(false);
        }
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `pending-${Date.now()}`,
          conversation_id: id!,
          role: "user",
          content: text,
          model: null,
          attachments: attachments.length ? attachments : null,
          created_at: Date.now(),
        },
      ]);
      startStream({
        conversationId: id!,
        content: text,
        attachments: attachments.length ? attachments : undefined,
        model,
        webSearch,
        think,
        designImages: mode === "design" ? designImages : undefined,
        imageModel:
          mode === "design" && designImages && designImageModel ? designImageModel : undefined,
      });
    },
    [
      convId,
      model,
      tempMode,
      // Without this, send captures the agent chosen at mount — which is null —
      // so clicking a chip set the state and the conversation was still created
      // without an agent_id. The API path was right the whole time; only the
      // closure was stale, and nothing but a live model could show it.
      pendingAgent,
      imageMode,
      research,
      webSearch,
      think,
      agentMode,
      designImages,
      designImageModel,
      designSystemId,
      mode,
      onConversationCreated,
      onConversationsChanged,
      loadConversation,
      startStream,
    ]
  );
  sendRef.current = send;

  // Canvas quick-actions: one click sends a scoped edit instruction to the model,
  // which reads the artifact and emits an update.
  useEffect(() => {
    const onCanvas = (e: Event) => {
      const instruction = (e as CustomEvent<string>).detail;
      if (typeof instruction === "string" && instruction && !isStreaming) {
        sendRef.current?.(instruction, []);
      }
    };
    window.addEventListener("liberde-canvas", onCanvas);
    return () => window.removeEventListener("liberde-canvas", onCanvas);
  }, [isStreaming]);

  const stop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
    stopBgPoll();
    // Also release the server-side lock so a stuck/background run is cleared
    // and the user can send again immediately (Stop must actually stop).
    const id = convIdRef.current;
    if (id) api(`/api/conversations/${id}/cancel`, { method: "POST" }).catch(() => {});
  };

  const regenerate = (withModel?: string) => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant || !convId) return;
    if (withModel && withModel !== model) changeModel(withModel);
    setMessages((m) => m.slice(0, m.indexOf(lastAssistant)));
    startStream({
      conversationId: convId,
      truncateFromMessageId: lastAssistant.id,
      model: withModel || model,
      webSearch,
      think,
    });
  };

  const shareChat = async () => {
    if (!convId) return;
    const { shareId } = await api<{ shareId: string }>(
      `/api/conversations/${convId}/share`,
      { method: "POST" }
    );
    const url = `${window.location.origin}/share/${shareId}`;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const [compressing, setCompressing] = useState(false);
  const compressChat = async () => {
    if (!convId || compressing) return;
    setCompressing(true);
    try {
      await api(`/api/conversations/${convId}/compress`, { method: "POST" });
      await loadConversation(convId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setCompressing(false);
    }
  };

  // Rough token estimate (~4 chars/token) across the transcript actually sent.
  const estTokens = messages.reduce(
    (sum, m) => sum + Math.ceil(((m.content ?? "").length + (m.reasoning?.length ?? 0)) / 4),
    0
  );
  const ctxLimit = models.find((m) => m.id === model)?.context_length || 0;

  const submitEdit = (msg: Message) => {
    const text = editValue.trim();
    setEditingId(null);
    if (!text || !convId) return;
    const idx = messages.indexOf(msg);
    setMessages((m) => [
      ...m.slice(0, idx),
      { ...msg, content: text, id: `pending-${Date.now()}` },
    ]);
    startStream({
      conversationId: convId,
      content: text,
      truncateFromMessageId: msg.id,
      attachments: msg.attachments ?? undefined,
      model,
      webSearch,
      think,
    });
  };

  const changeModel = async (next: string) => {
    setModel(next);
    if (convId) {
      await api(`/api/conversations/${convId}`, {
        method: "PATCH",
        body: JSON.stringify({ model: next }),
      });
      // Reassure: the switch keeps the same thread; history is replayed to the new model.
      if (messages.length > 0) {
        const label = models.find((m) => m.id === next)?.name ?? next;
        setModelNote(`Now using ${label} — this conversation continues with full history.`);
        setTimeout(() => setModelNote(null), 4000);
      }
    }
  };

  const changeDesignSystem = (id: string | null) => {
    setDesignSystemId(id);
    if (convId) {
      api(`/api/conversations/${convId}`, {
        method: "PATCH",
        body: JSON.stringify({ designSystemId: id }),
      }).catch(() => {});
    }
  };

  const projectName = conversation?.project_id
    ? projects.find((p) => p.id === conversation.project_id)?.name
    : null;

  // Once a conversation exists it owns the agent; before that, the pick does.
  const activeAgent =
    agents.find((a) => a.id === conversation?.agent_id) ??
    (convId ? null : pendingAgent);

  const showWelcome = messages.length === 0 && !isStreaming;

  return (
    <div className="relative flex min-w-0 flex-1">
    {lightboxSrc && (
      <div
        className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/85 p-4"
        onClick={() => setLightboxSrc(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={lightboxSrc}
          alt="Full size"
          className="max-h-full max-w-full rounded-lg object-contain"
        />
        <button
          onClick={() => setLightboxSrc(null)}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-lg text-white"
          title="Close"
        >
          ✕
        </button>
      </div>
    )}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 md:gap-3 md:px-4">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            title="Open menu"
            className="shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink md:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
        )}
        {activeAgent && (
          <span
            title={activeAgent.description || "Started as this agent"}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-xs"
          >
            <Icon name={activeAgent.icon || "sparkles"} size={13} className="text-accent" />
            <span className="max-w-[10rem] truncate font-medium">{activeAgent.name}</span>
            {!convId && (
              <button
                onClick={() => setPendingAgent(null)}
                title="Start an ordinary chat instead"
                className="text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            )}
          </span>
        )}
        <ModelPicker models={models} value={model} onChange={changeModel} />
        <button
          onClick={() => setShowAdvisor(true)}
          title="Not sure which model? Let me help you pick"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="sparkles" size={13} /> <span className="hidden sm:inline">Help me pick</span>
        </button>
        {mode === "design" && (
          <button
            onClick={() => setDesignImages((v) => !v)}
            title="Generate real images with the image model (vs placeholder images)"
            className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              designImages
                ? "border-accent bg-accent text-white"
                : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon name="image" size={13} /> <span className="hidden sm:inline">AI images</span>
          </button>
        )}
        {mode === "design" && designImages && (
          <ModelPicker
            models={models.filter((m) => m.outputsImages)}
            value={designImageModel || settings?.imageModel || ""}
            onChange={setDesignImageModel}
          />
        )}
        {mode === "design" && (
          <DesignSystemChip
            systems={designSystems}
            value={designSystemId}
            onChange={changeDesignSystem}
            compact
          />
        )}
        {projectName && (
          <span
            title={`Project: ${projectName}`}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-muted"
          >
            <Icon name="folder" size={12} />
            <span className="hidden sm:inline">{projectName}</span>
          </span>
        )}
        {conversation && messages.length > 0 && ctxLimit > 0 && (
          <ContextGauge
            used={estTokens}
            limit={ctxLimit}
            compressing={compressing}
            onCompress={compressChat}
          />
        )}
        <span className="hidden min-w-0 flex-1 truncate text-center text-sm text-ink-muted sm:block">
          {conversation?.title ?? ""}
        </span>
        <span className="flex-1 sm:hidden" />
        {(() => {
          const total = messages.reduce((sum, m) => sum + (m.cost ?? 0), 0);
          const wh = messages.reduce(
            (sum, m) => sum + estimateWh(m.tokens_in ?? 0, m.tokens_out ?? 0, m.model),
            0
          );
          const ecoLine =
            wh > 0
              ? `\nEstimated footprint: ${fmtWh(wh)} · ${fmtCo2(co2Grams(wh))} CO₂e — ${ecoEquivalence(wh)}\n(rough estimate from tokens, not measured)`
              : "";
          return total > 0 ? (
            <span
              className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-muted"
              title={`Total spent in this conversation (all model calls, searches, tools)${ecoLine}`}
            >
              {fmtCost(total)}
            </span>
          ) : null;
        })()}
        {/* Hands-free Voice mode hidden for now — dictation mic stays in the composer. */}
        {!conversation && (
          <button
            onClick={() => setTempMode((v) => !v)}
            title="Temporary chats don't appear in history, don't use memory, and are auto-deleted."
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs ${
              tempMode
                ? "border-accent bg-accent text-white"
                : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            <Icon name="temp" size={13} /> <span className="hidden sm:inline">Temporary</span>
          </button>
        )}
        {conversation?.is_temp ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-muted">
            <Icon name="temp" size={13} />{" "}
            <span className="hidden sm:inline">Temporary — not saved to history</span>
            <span className="sm:hidden">Temporary</span>
          </span>
        ) : (
          conversation &&
          messages.length > 0 && (
            <>
              <button
                title="Duplicate this chat into a new conversation"
                onClick={async () => {
                  if (!convId) return;
                  const { conversationId } = await api<{ conversationId: string }>(
                    `/api/conversations/${convId}/fork`,
                    { method: "POST" }
                  );
                  window.location.href = `/c/${conversationId}`;
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                <Icon name="copy" size={13} /> <span className="hidden sm:inline">Fork</span>
              </button>
              <button
                title="Download this chat as markdown"
                onClick={() => exportChat(conversation.title, messages)}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                <Icon name="download" size={13} /> <span className="hidden sm:inline">MD</span>
              </button>
              <button
                title="Save this chat as a PDF"
                onClick={() => exportChatPDF(conversation.title, messages)}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                <Icon name="file" size={13} /> <span className="hidden sm:inline">PDF</span>
              </button>
              <button
                onClick={shareChat}
                title="Share this chat as a public snapshot link"
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                <Icon name="share" size={13} /> <span className="hidden sm:inline">Share</span>
              </button>
            </>
          )
        )}
      </header>

      {showAdvisor && (
        <ModelAdvisor
          models={models}
          currentDefault={settings?.defaultModel}
          designMode={mode === "design"}
          onUse={changeModel}
          onClose={() => setShowAdvisor(false)}
        />
      )}

      {compareFor && convId && (
        <ComparePanel
          models={models}
          conversationId={convId}
          truncateFromMessageId={compareFor.messageId}
          currentModel={model}
          question={compareFor.question}
          // Compare replays the thread server-side, so an image anywhere in the
          // retained history reaches every column — not just one on this message.
          hasImages={messages.some((m) => (m.images?.length ?? 0) > 0)}
          onClose={() => setCompareFor(null)}
          onCommitted={(picked) => {
            setModel(picked);
            loadConversation(convId);
          }}
        />
      )}

      {shareUrl && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-sm">
          <span className="text-ink-muted">Public snapshot link (copied):</span>
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs"
          />
          <button
            onClick={() => setShareUrl(null)}
            className="text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
      )}

      {memoryToast && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-ink-muted">
          <Icon name="brain" size={13} /> Memory updated — manage in Settings → Personalization
        </div>
      )}
      {modelNote && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-ink-muted">
          <Icon name="refresh" size={13} /> {modelNote}
        </div>
      )}

      <div ref={scrollRef} onScroll={onThreadScroll} className="min-h-0 flex-1 overflow-y-auto">
        {showWelcome && mode === "design" ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
            <div className="login-logo mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white">
              <Icon name="pencil" size={26} />
            </div>
            <h1 className="font-display text-4xl font-medium tracking-tight">
              {timeGreeting(userName)}
            </h1>
            <p className="mt-3 max-w-md text-sm text-ink-muted">
              Pick a starting point, or just describe it. I’ll ask a couple of quick
              questions, then build an interactive design on the canvas — tweak it in
              plain language after.
            </p>
            <div className="mt-5">
              <DesignSystemChip
                systems={designSystems}
                value={designSystemId}
                onChange={changeDesignSystem}
              />
            </div>
            {settings?.hasApiKey && (
              <div className="anim-stagger mt-8 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3">
                {DESIGN_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => send(t.prompt, [])}
                    className="flex flex-col items-start gap-1 rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition-colors hover:border-accent"
                  >
                    <Icon name={t.icon} size={18} className="text-accent" />
                    <span className="mt-1 text-sm font-medium">{t.label}</span>
                    <span className="text-xs text-ink-muted">{t.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : showWelcome ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
            <h1 className="font-display text-4xl font-medium tracking-tight">
              {timeGreeting(userName)}
            </h1>
            {agents.length > 0 && (
              <div className="anim-stagger mt-6 w-full max-w-2xl">
                <p className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
                  Start as an agent
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setPendingAgent(a);
                        // The agent's model is a starting point; showing it now means
                        // the picker never disagrees with what will answer.
                        if (a.model) changeModel(a.model);
                      }}
                      title={a.description || a.name}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                        pendingAgent?.id === a.id
                          ? "border-accent bg-accent/10"
                          : "border-line bg-surface hover:border-accent"
                      }`}
                    >
                      <Icon name={a.icon || "sparkles"} size={14} className="text-accent" />
                      {a.name}
                    </button>
                  ))}
                </div>
                {pendingAgent && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {pendingAgent.description
                      ? pendingAgent.description + " — ask it anything below."
                      : "Ask it anything below."}
                  </p>
                )}
              </div>
            )}
            {settings?.hasApiKey && (
              <div className="anim-stagger mt-8 grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => send(p.prompt, [])}
                    className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm shadow-sm hover:border-accent"
                  >
                    <Icon name={p.icon} size={17} className="shrink-0 text-accent" />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((msg, i) => {
              const anchorId = i === 0 ? "" : messages[i - 1].id;
              const variants = branches.filter((b) => b.anchor_id === anchorId);
              const switcher =
                variants.length > 0 && !isStreaming ? (
                  <BranchSwitcher
                    count={variants.length + 1}
                    onPrev={() => switchBranch(variants[variants.length - 1].id)}
                    onNext={() => switchBranch(variants[0].id)}
                  />
                ) : null;
              const runOutput =
                msg.role === "user" ? parseRunResult(msg.content) : null;
              let toolName: string | undefined;
              if (msg.role === "tool") {
                for (let j = i - 1; j >= 0; j--) {
                  const tcs = messages[j].tool_calls as
                    | { id: string; function?: { name?: string } }[]
                    | null;
                  const hit = tcs?.find((tc) => tc.id === msg.tool_call_id);
                  if (hit) {
                    toolName = hit.function?.name;
                    break;
                  }
                }
              }
              const inner = runOutput !== null ? (
                <RunResultBlock output={runOutput} />
              ) : msg.role === "tool" ? (
                <ToolResultBlock output={msg.content} name={toolName} />
              ) : msg.role === "user" ? (
                <div className="anim-rise group mb-6 flex justify-end">
                  <div className="max-w-[85%]">
                    {editingId === msg.id ? (
                      <div className="rounded-2xl border border-accent bg-surface p-2">
                        <textarea
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          rows={Math.min(10, editValue.split("\n").length + 1)}
                          className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none"
                        />
                        <div className="flex justify-end gap-2 px-1 pb-1">
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-2"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => submitEdit(msg)}
                            className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mb-1 flex flex-wrap justify-end gap-2">
                            {msg.attachments.map((a, i) =>
                              a.dataUrl && a.mime.startsWith("image/") ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={i}
                                  src={a.dataUrl}
                                  alt={a.name}
                                  onClick={() => setLightboxSrc(a.dataUrl!)}
                                  className="max-h-40 max-w-full cursor-zoom-in rounded-lg border border-line"
                                />
                              ) : (
                                <span
                                  key={i}
                                  className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-ink-muted"
                                >
                                  <Icon
                                    name={
                                      a.mime === "application/pdf" ||
                                      a.mime === DOCX_MIME ||
                                      a.mime === DOC_MIME
                                        ? "filePdf"
                                        : "fileText"
                                    }
                                    size={12}
                                    className="mr-1 inline-block align-[-2px]"
                                  />
                                  {a.name}
                                </span>
                              )
                            )}
                          </div>
                        )}
                        <div className="rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                          {msg.content}
                        </div>
                        {!isStreaming && (
                          <div className="mt-1 hidden justify-end group-hover:flex">
                            <button
                              onClick={() => {
                                setEditingId(msg.id);
                                setEditValue(msg.content);
                              }}
                              className="text-xs text-ink-muted hover:text-ink"
                            >
                              <Icon name="pencil" size={12} className="mr-1 inline-block align-[-2px]" />
                      Edit
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="anim-rise group mb-6">
                  {msg.reasoning && (
                    <ThinkingBlock text={msg.reasoning} durationMs={msg.reasoning_ms} />
                  )}
                  {Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {(msg.tool_calls as { function?: { name?: string } }[]).map(
                        (tc, i) => (
                          <span
                            key={i}
                            className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-ink-muted"
                          >
                            <Icon name="wrench" size={12} className="mr-1 inline-block align-[-2px]" />
                          {(tc.function?.name ?? "tool").replace(/__/g, ": ")}
                          </span>
                        )
                      )}
                    </div>
                  )}
                  <AssistantContent
                    content={msg.content}
                    messageId={msg.id}
                    artifacts={artifacts}
                    onOpenArtifact={(identifier, version) =>
                      openArtifact(identifier, artifacts, version)
                    }
                    onShowCodePreview={openCodePreview}
                    onAnswer={(t) => send(t, [])}
                    interactive={
                      !isStreaming && messages[messages.length - 1]?.id === msg.id
                    }
                    annotations={msg.annotations}
                  />
                  {msg.images?.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt="Generated"
                      onClick={() => setLightboxSrc(src)}
                      className="mt-2 h-auto max-w-full cursor-zoom-in rounded-xl border border-line md:max-w-md"
                    />
                  ))}
                  {msg.annotations && msg.annotations.length > 0 && (
                    <Citations annotations={msg.annotations} />
                  )}
                  <div
                    className={`mt-1.5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted ${
                      !isStreaming && messages[messages.length - 1]?.id === msg.id
                        ? "flex"
                        : "hidden group-hover:flex"
                    }`}
                  >
                    {msg.model && (
                      <span
                        className="inline-flex items-center gap-1"
                        title={
                          msg.route_reason
                            ? `Auto-routed — ${msg.route_reason}`
                            : undefined
                        }
                      >
                        {msg.route_reason && <Icon name="sparkles" size={12} />}
                        {msg.route_reason ? `Auto → ${msg.model}` : msg.model}
                      </span>
                    )}
                    {msg.cost != null && msg.cost > 0 && (
                      <span title={costTooltip(msg)}>{fmtCost(msg.cost)}</span>
                    )}
                    {msg.tokens_out != null && msg.tokens_out > 0 && (
                      <span title="Output tokens">{num(msg.tokens_out)} tok</span>
                    )}
                    {msg.duration_ms != null && msg.duration_ms > 0 && (
                      <span title="Generation time">{fmtDuration(msg.duration_ms)}</span>
                    )}
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      title="Copy"
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      <Icon name="copy" size={13} /> Copy
                    </button>
                    {!isStreaming &&
                      messages[messages.length - 1]?.id === msg.id && (
                        <>
                          <RegenerateControl
                            models={models}
                            currentModel={model}
                            onRegenerate={regenerate}
                          />
                          <button
                            onClick={() => {
                              const idx = messages.findIndex((m) => m.id === msg.id);
                              const question =
                                [...messages.slice(0, idx)]
                                  .reverse()
                                  .find((m) => m.role === "user")?.content ?? "";
                              setCompareFor({ messageId: msg.id, question });
                            }}
                            title="Compare other models' answers to this question"
                            className="inline-flex items-center gap-1 hover:text-ink"
                          >
                            <Icon name="sparkles" size={13} /> Second opinion
                          </button>
                        </>
                      )}
                  </div>
                </div>
              );
              return (
                <div key={msg.id}>
                  {switcher}
                  {inner}
                </div>
              );
            })}

            {/* A turn that died mid-tool-loop (timeout/crash) leaves the tail
                on a tool step with no final reply — offer to pick it back up
                instead of looking like the work silently vanished. */}
            {!isStreaming &&
              !bgWorking &&
              (() => {
                const tail = messages[messages.length - 1];
                const interrupted =
                  tail &&
                  (tail.role === "tool" ||
                    (tail.role === "assistant" &&
                      (tail.tool_calls?.length ?? 0) > 0 &&
                      !tail.content.trim()));
                if (!interrupted) return null;
                return (
                  <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      This turn was interrupted before the reply finished — the tool
                      steps above are saved.
                    </span>
                    <button
                      onClick={() =>
                        convId &&
                        startStream({ conversationId: convId, model, webSearch, think })
                      }
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                    >
                      Continue from here
                    </button>
                    <span className="shrink-0 text-xs text-ink-muted">
                      (a faster model helps — switch above, then continue)
                    </span>
                  </div>
                );
              })()}

            {isStreaming && (
              <div className="is-streaming mb-6">
                {researchStatuses.length > 0 && (
                  <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
                    {researchStatuses.map((s, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 py-0.5 text-xs ${
                          i === researchStatuses.length - 1 && !streamText
                            ? "text-ink"
                            : "text-ink-muted"
                        }`}
                      >
                        <span>
                          {i === researchStatuses.length - 1 && !streamText ? (
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                          ) : (
                            <Icon name="check" size={12} className="text-accent" />
                          )}
                        </span>
                        {s}
                      </div>
                    ))}
                  </div>
                )}
                {streamReasoning && (
                  <ThinkingBlock text={streamReasoning} live={!streamText} />
                )}
                {streamText ? (
                  <AssistantContent
                    content={streamText}
                    messageId={null}
                    artifacts={artifacts}
                    onOpenArtifact={() => {}}
                    onShowCodePreview={openCodePreview}
                  />
                ) : streamReasoning || researchStatuses.length > 0 ? null : (
                  <div className="flex items-center gap-2 text-sm text-ink-muted">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                    Thinking…
                  </div>
                )}
              </div>
            )}

            {bgWorking && !isStreaming && bgPartial && (
              <div className="mb-2">
                <Markdown content={bgPartial} onShowArtifact={openCodePreview} />
              </div>
            )}

            {bgWorking && !isStreaming && (
              <div className="mb-6 flex items-center gap-2 text-sm text-ink-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                {bgPartial
                  ? "Still writing…"
                  : "Liberde is working on this response… it'll appear here when ready."}
                <button
                  onClick={stop}
                  className="ml-1 rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2 hover:text-ink"
                >
                  Stop
                </button>
              </div>
            )}

            {error && (
              <div className="mb-6 max-h-48 overflow-y-auto overflow-x-hidden rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm break-words whitespace-pre-wrap text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {mode === "design" && !showWelcome && !isStreaming && messages.some((m) => m.role === "assistant") && (
        <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5 px-4 pb-1">
          {DESIGN_TWEAKS.map((t) => (
            <button
              key={t.label}
              onClick={() => send(t.prompt, [])}
              title={t.prompt}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {runFiles.length > 0 && (
        <div className="anim-rise mx-auto flex max-w-3xl flex-wrap items-center gap-1.5 px-4 pb-1">
          <span className="text-[11px] text-ink-muted">Produced:</span>
          {runFiles.map((file, i) => (
            <span
              key={file.name + i}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
            >
              {/* An image is worth showing rather than only naming — a chart the
                  analysis produced is usually the answer, not an attachment to it. */}
              {file.mime.startsWith("image/") ? (
                <img
                  src={"data:" + file.mime + ";base64," + file.base64}
                  alt={file.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Icon name="fileText" size={13} className="shrink-0 text-ink-muted" />
              )}
              <a
                href={"data:" + file.mime + ";base64," + file.base64}
                download={file.name}
                className="max-w-48 truncate hover:text-accent"
                title={"Download " + file.name}
              >
                {file.name}
              </a>
              <button
                onClick={() => setRunFiles((prev) => prev.filter((_, j) => j !== i))}
                title="Dismiss"
                className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {queued && (
        <div className="anim-rise mx-auto flex max-w-3xl items-center gap-2 px-4 pb-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-muted">
            <Icon name="clock" size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={queued.text}>
              {queued.text}
            </span>
            <span className="shrink-0 whitespace-nowrap">
              sends when this reply finishes
            </span>
            <button
              onClick={() => setQueued(null)}
              title="Discard this queued message"
              className="shrink-0 rounded p-0.5 hover:bg-surface hover:text-ink"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
      )}

      <Composer
        disabled={!settings?.hasApiKey}
        isStreaming={isStreaming}
        onSend={send}
        onQueue={queueMessage}
        onStop={stop}
        webSearch={webSearch}
        onToggleWebSearch={() => setWebSearch((v) => !v)}
        think={think}
        onToggleThink={() => setThink((v) => !v)}
        imageMode={imageMode}
        onToggleImageMode={() => setImageMode((v) => !v)}
        research={research}
        onToggleResearch={() => setResearch((v) => !v)}
        agentMode={agentMode}
        onToggleAgentMode={() => setAgentMode((v) => !v)}
        modelSupportsImages={
          models.find((m) => m.id === model)?.supportsImages ?? true
        }
      />
    </div>

    {panel && (
      <ArtifactPanel
        content={panel}
        designCanvas={mode === "design"}
        designSystem={
          designSystems.find((d) => d.id === designSystemId) ?? null
        }
        onClose={() => setPanel(null)}
        onRecordUpdated={handleRecordUpdated}
        onVersionSaved={async (artifactId) => {
          if (!convIdRef.current) return;
          const list = await loadArtifacts(convIdRef.current);
          const artifact = list.find((a) => a.id === artifactId);
          if (artifact) setPanel({ kind: "artifact", artifact });
        }}
      />
    )}
    </div>
  );
}

function linkifyCitations(
  text: string,
  annotations?: Message["annotations"] | null
): string {
  if (!annotations?.length) return text;
  const urls = annotations
    .map((a) => a.url_citation?.url)
    .filter((u): u is string => Boolean(u));
  if (!urls.length) return text;
  // Turn [1], [2] … into markdown links to the matching source (skip code spans).
  return text.replace(/(`[^`]*`)|\[(\d{1,2})\]/g, (m, code, n) => {
    if (code) return code;
    const idx = Number(n) - 1;
    return urls[idx] ? `[[${n}]](${urls[idx]})` : m;
  });
}

function AssistantContent({
  content,
  messageId,
  artifacts,
  onOpenArtifact,
  onShowCodePreview,
  onAnswer,
  interactive,
  annotations,
}: {
  content: string;
  messageId: string | null;
  artifacts: ArtifactWithVersions[];
  onOpenArtifact: (identifier: string, version?: number) => void;
  onShowCodePreview: (p: CodePreview) => void;
  onAnswer?: (text: string) => void;
  interactive?: boolean;
  annotations?: Message["annotations"] | null;
}) {
  const segments = splitContentSegments(content);

  const handleCard = (block: ParsedBlock) => {
    const artifact = artifacts.find((a) => a.identifier === block.identifier);
    if (artifact) {
      const version = messageId
        ? artifact.versions.find((v) => v.message_id === messageId)?.version
        : undefined;
      onOpenArtifact(block.identifier, version);
    } else if (block.content) {
      onShowCodePreview({
        code: block.content,
        lang: block.type === "react" ? "tsx" : block.type ?? "code",
        title: block.title ?? block.identifier,
      });
    }
  };

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          // Memory tags are persisted server-side and stripped from saved content;
          // hide them client-side too so they never flash while streaming.
          const visible = seg.text
            ?.replace(/<liberdeMemory>[\s\S]*?(<\/liberdeMemory>|$)/g, "")
            .trim();
          if (!visible) return null;
          // Split out interactive question blocks so they render as option cards.
          return (
            <div key={i}>
              {splitAsk(visible).map((part, j) =>
                part.type === "ask" ? (
                  <QuestionCard
                    key={j}
                    questions={part.questions}
                    interactive={Boolean(interactive && onAnswer)}
                    onSubmit={(answer) => onAnswer?.(answer)}
                  />
                ) : part.value.trim() ? (
                  <Markdown
                    key={j}
                    content={linkifyCitations(part.value, annotations)}
                    onShowArtifact={onShowCodePreview}
                  />
                ) : null
              )}
            </div>
          );
        }
        if (seg.kind === "artifact" && seg.block) {
          const block = seg.block;
          const artifact = artifacts.find((a) => a.identifier === block.identifier);
          const label =
            block.command === "update"
              ? `Updated ${artifact?.title ?? block.identifier}`
              : block.title ?? artifact?.title ?? block.identifier;
          return (
            <ArtifactCard
              key={i}
              icon={typeIcon(block.type ?? artifact?.type ?? "code")}
              label={label}
              sub={
                block.command === "update"
                  ? `${block.replacements.length} edit${block.replacements.length === 1 ? "" : "s"}`
                  : block.type ?? artifact?.type ?? "artifact"
              }
              onClick={() => handleCard(block)}
            />
          );
        }
        if (seg.kind === "streaming-artifact" && seg.partial) {
          return (
            <ArtifactCard
              key={i}
              icon={typeIcon(seg.partial.type)}
              label={seg.partial.title || seg.partial.identifier || "Artifact"}
              sub="generating…"
              pulsing
            />
          );
        }
        if (seg.kind === "run" || seg.kind === "streaming-run") {
          return (
            <RunCard
              key={i}
              code={seg.runCode ?? ""}
              running={seg.kind === "streaming-run"}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function RunCard({ code, running }: { code: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-2 px-3 py-1.5 text-left text-xs text-ink-muted"
      >
        <span className={running ? "animate-pulse" : ""}>
          <Icon name="flask" size={13} />
        </span>
        <span className="flex-1">
          {running ? "Writing analysis code…" : "Ran JavaScript analysis"}
        </span>
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto bg-surface px-3 py-2 text-xs leading-relaxed">
          {code}
        </pre>
      )}
    </div>
  );
}

interface MinimalRecognition {
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: {
    resultIndex: number;
    results: { [i: number]: { isFinal: boolean; 0: { transcript: string } }; length: number };
  }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}

function getRecognitionCtor(): (new () => MinimalRecognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalRecognition;
    webkitSpeechRecognition?: new () => MinimalRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function stripForSpeech(text: string): string {
  return text
    .replace(/<liberdeArtifact[\s\S]*?(<\/liberdeArtifact>|$)/g, " (artifact) ")
    .replace(/<liberdeRun[\s\S]*?(<\/liberdeRun>|$)/g, " (analysis) ")
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/[*_#`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function fmtCost(cost: number): string {
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Hover text for a message's cost: tokens + where the money went. */
function costTooltip(msg: Message): string | undefined {
  const parts: string[] = [];
  if (msg.tokens_in) {
    parts.push(`${msg.tokens_in} tokens in · ${msg.tokens_out ?? 0} tokens out`);
  }
  // Cache hits are the only way to tell a warm prefix from a silently
  // invalidated one, so surface them next to the tokens they discounted.
  if (msg.cached_tokens_in) {
    const saved = msg.cache_discount ? ` · saved ${fmtCost(msg.cache_discount)}` : "";
    parts.push(`${num(msg.cached_tokens_in)} of those served from cache${saved}`);
  }
  try {
    const bd = msg.cost_breakdown ? JSON.parse(msg.cost_breakdown) : null;
    if (bd && typeof bd === "object") {
      const labels: Record<string, string> = {
        model: "model",
        search: "web search",
        image: "image",
      };
      const bits = Object.entries(bd)
        .filter(([, v]) => typeof v === "number" && (v as number) > 0)
        .map(([k, v]) => `${labels[k] ?? k} ${fmtCost(v as number)}`);
      if (bits.length > 1) parts.push(bits.join(" · "));
    }
  } catch {
    /* ignore malformed breakdown */
  }
  return parts.length ? parts.join("\n") : undefined;
}

function exportChat(title: string, messages: Message[]) {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    if (m.role === "tool") continue;
    const label = m.role === "user" ? "**You**" : `**Liberde**${m.model ? ` (${m.model})` : ""}`;
    lines.push(`${label}:`, "", m.content, "", "---", "");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chat"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render markdown to static HTML using the app's own renderer (GFM tables,
 *  lists, code fences) — synchronously, via an offscreen React root. */
function mdToStaticHtml(md: string): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>);
    });
    return host.innerHTML;
  } catch {
    return `<p style="white-space:pre-wrap">${escapeHtml(md)}</p>`;
  } finally {
    root.unmount();
  }
}

/** Open a nicely typeset printable window and trigger print ("Save as PDF"). */
function exportChatPDF(title: string, messages: Message[]) {
  const body = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const who =
        m.role === "user" ? "You" : `Liberde${m.model ? ` · ${escapeHtml(m.model)}` : ""}`;
      // Replace machine tags with readable placeholders before rendering.
      const cleaned = m.content
        .replace(
          /<liberdeArtifact\b[^>]*?title="([^"]*)"[\s\S]*?(<\/liberdeArtifact>|$)/g,
          (_s, t) => `\n> 🖼 **Artifact:** ${t || "untitled"}\n`
        )
        .replace(/<liberdeArtifact[\s\S]*?(<\/liberdeArtifact>|$)/g, "\n> 🖼 **Artifact**\n")
        .replace(/<liberde(Run|Ask|Memory)>[\s\S]*?(<\/liberde\1>|$)/g, "")
        .trim();
      const imgs = (m.images ?? [])
        .map((src) => `<img class="genimg" src="${escapeHtml(src)}" alt="Generated image">`)
        .join("");
      return `<section class="msg ${m.role}">
  <div class="who">${who}</div>
  <div class="body md">${mdToStaticHtml(cleaned)}${imgs}</div>
</section>`;
    })
    .join("\n");
  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const replies = messages.filter((m) => m.role === "assistant").length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:14px/1.65 -apple-system,"Segoe UI",system-ui,sans-serif;max-width:760px;margin:0 auto;padding:40px 24px;color:#1f1e1b;background:#fff}
  header.doc{border-bottom:2px solid #d97757;padding-bottom:14px;margin-bottom:8px}
  .wordmark{font-family:Georgia,serif;font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#d97757}
  h1.doc{font-family:Georgia,serif;font-size:26px;line-height:1.25;margin:6px 0 4px}
  .meta{font-size:12px;color:#8a857c}
  .msg{margin:22px 0}
  .who{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#8a857c;margin-bottom:6px;break-after:avoid}
  .user .body{background:#f5f1e9;border:1px solid #ebe5d8;border-radius:12px;padding:12px 16px}
  .genimg{display:block;max-width:100%;border-radius:10px;margin:10px 0;border:1px solid #e6e2da}
  footer.doc{margin-top:36px;padding-top:12px;border-top:1px solid #e6e2da;font-size:11px;color:#8a857c;text-align:center}
  /* Markdown typography */
  .md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
  .md p{margin:.6em 0}
  .md h1,.md h2,.md h3,.md h4{font-family:Georgia,serif;line-height:1.3;margin:1.1em 0 .45em;break-after:avoid}
  .md h1{font-size:20px}.md h2{font-size:17px}.md h3{font-size:15px}.md h4{font-size:14px}
  .md ul,.md ol{margin:.5em 0;padding-left:1.5em}
  .md li{margin:.25em 0}
  .md li>p{margin:.2em 0}
  .md a{color:#b05730;text-decoration:none;border-bottom:1px solid #e0b7a3}
  .md strong{font-weight:650}
  .md code{background:#f4f1ea;border:1px solid #eae5da;border-radius:4px;padding:1px 5px;font:12px/1.5 ui-monospace,Consolas,monospace}
  .md pre{background:#f7f4ee;border:1px solid #e8e3d8;border-radius:10px;padding:12px 14px;overflow:hidden;white-space:pre-wrap;word-break:break-word}
  .md pre code{background:none;border:none;padding:0}
  .md blockquote{border-left:3px solid #d97757;margin:.7em 0;padding:.1em 0 .1em 14px;color:#5f5a51}
  .md table{border-collapse:collapse;margin:.8em 0;width:100%;font-size:13px}
  .md th{background:#f4f1ea;text-align:left}
  .md th,.md td{border:1px solid #e2ddd2;padding:6px 10px;vertical-align:top}
  .md tr{break-inside:avoid}
  .md hr{border:none;border-top:1px solid #e6e2da;margin:1.2em 0}
  .md img{max-width:100%}
  @page{margin:18mm 15mm}
</style></head><body>
  <header class="doc">
    <div class="wordmark">Liberde</div>
    <h1 class="doc">${escapeHtml(title)}</h1>
    <div class="meta">${date} · ${replies} ${replies === 1 ? "reply" : "replies"}</div>
  </header>
  ${body}
  <footer class="doc">Exported from Liberde — liberde.ai</footer>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

const STARTER_PROMPTS: { icon: string; label: string; prompt: string }[] = [
  {
    icon: "grid",
    label: "Build an interactive dashboard",
    prompt:
      "Build an interactive HTML dashboard with sample sales data — charts, KPI tiles, and a filterable table.",
  },
  {
    icon: "pencil",
    label: "Draft a document",
    prompt: "Help me draft a one-page project proposal. Ask me a few questions first.",
  },
  {
    icon: "flask",
    label: "Analyze some numbers",
    prompt:
      "If I invest $500/month at 7% annual return, what will I have in 20 years? Verify the math by running the calculation.",
  },
  {
    icon: "play",
    label: "Create a presentation",
    prompt:
      "Create a beautiful 8-slide presentation introducing our team to the basics of large language models — title slide, agenda, clear visuals, and a closing takeaways slide.",
  },
];

// A gentle, whimsical greeting that shifts with the time of day (and drifts a
// little day to day) — like Claude's home greeting. Deterministic within a day
// so it doesn't flicker across re-renders.
// A rotating, whimsical greeting — time-of-day lines plus playful name-forward
// ones (Claude-style: "Good evening, Neeraj", "Neeraj returns!", "Welcome
// back"). `{n}` is the user's first name. Varies by hour + day so it drifts
// through the set, but is stable within a given hour (no flicker on re-render).
function timeGreeting(name?: string): string {
  const now = new Date();
  const h = now.getHours();
  const first = name?.trim().split(/\s+/)[0] || "";
  const timed =
    h < 5
      ? ["Still up, {n}", "Burning the midnight oil, {n}", "The night is yours, {n}"]
      : h < 12
        ? ["Good morning, {n}", "Morning, {n}", "Rise and shine, {n}"]
        : h < 17
          ? ["Good afternoon, {n}", "Afternoon, {n}", "Hey there, {n}"]
          : h < 22
            ? ["Good evening, {n}", "Evening, {n}", "Hope your day was good, {n}"]
            : ["Winding down, {n}", "Still here, {n}", "One more, {n}?"];
  // Time-agnostic, playful — only used when we know the name.
  const playful = [
    "{n} returns!",
    "Welcome back, {n}",
    "Look who's back — {n}",
    "Back at it, {n}",
    "Good to see you, {n}",
    "Ready when you are, {n}",
  ];
  const pool = first ? [...timed, ...playful] : timed;
  const chosen = pool[(now.getDate() * 5 + h + now.getDay()) % pool.length];
  if (!first) return chosen.replace(/,?\s*\{n\}\??/g, "").trim() || "Hello";
  return chosen.replace("{n}", first);
}

/**
 * Every attachment in the thread, as files for the Python sandbox.
 *
 * Images are skipped: they are already visible to a vision model, and base64
 * pictures would dominate the payload written into the sandbox for no gain.
 * Text extracted from a PDF or document is written under the original
 * filename, so the model reads /data/report.pdf and gets the text it needs.
 */
function conversationFiles(messages: Message[]): SandboxFile[] {
  const out: SandboxFile[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (!a.name || seen.has(a.name)) continue;
      if (a.mime?.startsWith("image/")) continue;
      let base64: string | null = null;
      if (typeof a.text === "string" && a.text) {
        base64 = btoa(unescape(encodeURIComponent(a.text)));
      } else if (a.dataUrl) {
        base64 = a.dataUrl.split(",")[1] ?? null;
      }
      if (!base64) continue;
      seen.add(a.name);
      out.push({ name: a.name, base64, mime: a.mime || "application/octet-stream" });
    }
  }
  return out;
}
// Design-studio templates: each seeds a SHORT intent (not a full brief) so the
// ask-first flow kicks in — clicking a card should interview you, then build.
const DESIGN_TEMPLATES: {
  icon: string;
  label: string;
  desc: string;
  prompt: string;
}[] = [
  {
    icon: "presentation",
    label: "Pitch deck",
    desc: "Interactive startup deck",
    prompt: "I want to create an interactive startup pitch deck. Ask me a few quick questions first, then build it.",
  },
  {
    icon: "barChart",
    label: "Analytics dashboard",
    desc: "KPIs, charts, table",
    prompt: "I want to design an analytics dashboard. Ask me a few quick questions first, then build it.",
  },
  {
    icon: "layout",
    label: "SaaS landing page",
    desc: "Hero → pricing → CTA",
    prompt: "I want to design a SaaS landing page. Ask me a few quick questions first, then build it.",
  },
  {
    icon: "smartphone",
    label: "Mobile app flow",
    desc: "Clickable onboarding",
    prompt: "I want to design a clickable mobile app onboarding prototype. Ask me a few quick questions first, then build it.",
  },
  {
    icon: "lightbulb",
    label: "Explainer deck",
    desc: "Teach a concept",
    prompt: "I want to create an interactive explainer slide deck. Ask me a few quick questions first, then build it.",
  },
  {
    icon: "milestone",
    label: "Product roadmap",
    desc: "Timeline deck",
    prompt: "I want to design an interactive product roadmap presentation. Ask me a few quick questions first, then build it.",
  },
];

const DESIGN_TWEAKS: { icon: string; label: string; prompt: string }[] = [
  // Grouped roughly style, then structure, then motion — the order people
  // actually iterate in, and the reason each chip carries an icon: a row of
  // bare sentences reads as a wall of text at the exact moment the user is
  // scanning for one small change.
  { icon: "moon", label: "Dark mode", prompt: "Make it dark mode." },
  { icon: "droplet", label: "New palette", prompt: "Change the colour palette." },
  { icon: "type", label: "Bigger type", prompt: "Increase the type scale and tighten the headings." },
  { icon: "layout", label: "More minimal", prompt: "Make it more minimal — less chrome, more whitespace." },
  { icon: "plus", label: "Add a slide", prompt: "Add a slide." },
  { icon: "smartphone", label: "Mobile view", prompt: "Make it work well on a phone screen." },
  { icon: "sparkles", label: "More playful", prompt: "Make it more playful." },
  { icon: "play", label: "Add motion", prompt: "Add smooth animations and transitions." },
];

function BranchSwitcher({
  count,
  onPrev,
  onNext,
}: {
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-end gap-1 text-xs text-ink-muted">
      <button onClick={onPrev} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink" title="Previous version">
        ‹
      </button>
      <span>⑂ {count} versions</span>
      <button onClick={onNext} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink" title="Next version">
        ›
      </button>
    </div>
  );
}

function ToolResultBlock({ output, name }: { output: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const failed = output.startsWith("Error");
  const icon =
    name === "web_search"
      ? "search"
      : name === "fetch_page"
        ? "globe"
        : name?.startsWith("skill__")
          ? "brain"
          : "wrench";
  const label =
    name === "web_search"
      ? "Searched the web"
      : name === "fetch_page"
        ? "Read a page"
        : name?.startsWith("skill__")
          ? "Loaded skill"
          : name
            ? `Used ${name.replace(/__/g, ": ")}`
            : "Tool result";
  // Surface source links from web results directly on the card, Claude-style.
  const sources =
    name === "web_search" || name === "fetch_page"
      ? [...new Set(output.match(/https?:\/\/[^\s)\]]+/g) ?? [])].slice(0, 6)
      : [];
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-2 px-3 py-1.5 text-left text-xs text-ink-muted"
      >
        <Icon name={icon} size={13} className="shrink-0" />
        <span className="flex-1">
          {label}
          {failed ? " (error)" : ""}
        </span>
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {!open && sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface px-3 py-1.5">
          {sources.map((url) => {
            let host = url;
            try {
              host = new URL(url).hostname.replace(/^www\./, "");
            } catch {
              /* keep raw */
            }
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
              >
                {host}
              </a>
            );
          })}
        </div>
      )}
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {output}
        </pre>
      )}
    </div>
  );
}

function RunResultBlock({ output }: { output: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-2 px-3 py-1.5 text-left text-xs text-ink-muted"
      >
        <span>▸</span>
        <span className="flex-1">Execution result</span>
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {output}
        </pre>
      )}
    </div>
  );
}

interface AskQuestion {
  q: string;
  options?: string[];
  multi?: boolean;
}

type AskPart =
  | { type: "md"; value: string }
  | { type: "ask"; questions: AskQuestion[] };

/** Parse an ask payload leniently — models emit arrays, bare objects,
 *  {questions:[...]} wrappers, and code-fenced JSON. */
function parseAskPayload(raw: string): AskQuestion[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const coerce = (parsed: unknown): AskQuestion[] | null => {
    const qs = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { questions?: unknown[] })?.questions)
        ? (parsed as { questions: unknown[] }).questions
        : parsed && typeof parsed === "object" && typeof (parsed as AskQuestion).q === "string"
          ? [parsed]
          : null;
    if (!qs) return null;
    const clean = qs.filter(
      (q): q is AskQuestion => Boolean(q) && typeof (q as AskQuestion).q === "string"
    );
    return clean.length ? clean : null;
  };
  try {
    const result = coerce(JSON.parse(s));
    if (result) return result;
  } catch {
    /* fall through to extraction */
  }
  // Salvage: first JSON array or object embedded in surrounding prose.
  const embedded = s.match(/\[[\s\S]*\]/)?.[0] ?? s.match(/\{[\s\S]*\}/)?.[0];
  if (embedded) {
    try {
      return coerce(JSON.parse(embedded));
    } catch {
      /* truly malformed */
    }
  }
  return null;
}

/** Split assistant text into markdown and interactive <liberdeAsk> question blocks. */
function splitAsk(text: string): AskPart[] {
  const parts: AskPart[] = [];
  const re = /<liberdeAsk>([\s\S]*?)<\/liberdeAsk>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: "md", value: text.slice(last, m.index) });
    const qs = parseAskPayload(m[1]);
    if (qs) {
      parts.push({ type: "ask", questions: qs });
    } else {
      // Unsalvageable payload: show the questions' text as plain markdown
      // rather than raw tags/JSON.
      const qTexts = [...m[1].matchAll(/"q"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
      if (qTexts.length) {
        parts.push({ type: "md", value: qTexts.map((q) => `**${q}**`).join("\n\n") });
      }
    }
    last = re.lastIndex;
  }
  let rest = text.slice(last);
  // Hide an unterminated block still streaming in.
  rest = rest.replace(/<liberdeAsk\b[\s\S]*$/, "");
  if (rest) parts.push({ type: "md", value: rest });
  // Fallback for a fully-dropped message: never show raw <liberdeAsk> tags.
  return parts.length
    ? parts
    : [{ type: "md", value: text.replace(/<\/?liberdeAsk>/g, "").trim() }];
}

function QuestionCard({
  questions,
  interactive,
  onSubmit,
}: {
  questions: AskQuestion[];
  interactive: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);

  const pick = (qi: number, opt: string, multi?: boolean) =>
    setSel((s) => {
      const cur = s[qi] ?? [];
      if (multi) {
        return {
          ...s,
          [qi]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt],
        };
      }
      return { ...s, [qi]: cur[0] === opt ? [] : [opt] };
    });

  const submit = () => {
    const lines = questions.map((q, qi) => {
      const picks = [...(sel[qi] ?? [])];
      if (other[qi]?.trim()) picks.push(other[qi].trim());
      return `${q.q} → ${picks.length ? picks.join(", ") : "(no preference)"}`;
    });
    setSent(true);
    onSubmit(lines.join("\n"));
  };

  return (
    <div className="my-2 rounded-xl border border-line bg-surface p-3">
      {questions.map((q, qi) => (
        <div key={qi} className={qi > 0 ? "mt-3" : ""}>
          <p className="mb-1.5 text-sm font-medium">{q.q}</p>
          <div className="flex flex-wrap gap-1.5">
            {(q.options ?? []).map((opt) => {
              const on = (sel[qi] ?? []).includes(opt);
              return (
                <button
                  key={opt}
                  disabled={!interactive || sent}
                  onClick={() => pick(qi, opt, q.multi)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
                    on
                      ? "border-accent bg-accent text-white"
                      : "border-line text-ink-muted hover:border-accent hover:text-ink"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {interactive && !sent && (
            <input
              value={other[qi] ?? ""}
              onChange={(e) => setOther((o) => ({ ...o, [qi]: e.target.value }))}
              placeholder={(q.options?.length ?? 0) === 0 ? "Type your answer…" : "Other…"}
              className="mt-1.5 w-full rounded-lg border border-line bg-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
            />
          )}
        </div>
      ))}
      {interactive && !sent && (
        <button
          onClick={submit}
          className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Send answers
        </button>
      )}
      {sent && <p className="mt-3 text-xs text-ink-muted">Answers sent.</p>}
    </div>
  );
}

function RegenerateControl({
  models,
  currentModel,
  onRegenerate,
}: {
  models: ModelInfo[];
  currentModel: string;
  onRegenerate: (withModel?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = q.trim()
    ? models
        .filter(
          (m) =>
            m.id.toLowerCase().includes(q.toLowerCase()) ||
            m.name.toLowerCase().includes(q.toLowerCase())
        )
        .slice(0, 30)
    : models.slice(0, 30);

  // Which way to open, decided when it opens. The menu used to always drop
  // upward, so a reply near the top of the viewport had its model list clipped
  // by the top of the window with no way to scroll to it.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [drop, setDrop] = useState<{ up: boolean; maxH: number }>({ up: false, maxH: 320 });

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      // Prefer down. Only flip up when there is not enough room below for a
      // menu worth showing, and even then only if above is actually roomier.
      const up = below < 220 && above > below;
      setDrop({ up, maxH: Math.max(180, Math.min(360, up ? above : below)) });
    }
    setOpen((v) => !v);
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={() => onRegenerate()}
        title="Regenerate with the same model"
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        <Icon name="refresh" size={13} /> Regenerate
      </button>
      <button
        ref={triggerRef}
        onClick={toggle}
        title="Regenerate with a different model"
        className="ml-0.5 hover:text-ink"
      >
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 z-50 w-72 rounded-xl border border-line bg-surface p-1 shadow-xl ${
              drop.up ? "bottom-full mb-1" : "top-full mt-1"
            }`}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Regenerate with…"
              className="mb-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <div
              className="overflow-y-auto"
              style={{ maxHeight: Math.max(120, drop.maxH - 56) }}
            >
              {list.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setOpen(false);
                    onRegenerate(m.id);
                  }}
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2"
                  title={m.id}
                >
                  {m.name}
                  {m.id === currentModel ? " · current" : ""}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

function ContextGauge({
  used,
  limit,
  compressing,
  onCompress,
}: {
  used: number;
  limit: number;
  compressing: boolean;
  onCompress: () => void;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const near = pct >= 70;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  return (
    <div className="flex items-center gap-2" title={`~${used.toLocaleString()} of ${limit.toLocaleString()} tokens used`}>
      <div className="hidden items-center gap-1.5 sm:flex">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${near ? "bg-amber-500" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-[11px] ${near ? "text-amber-600 dark:text-amber-400" : "text-ink-muted"}`}>
          {fmt(used)}/{fmt(limit)}
        </span>
      </div>
      <button
        onClick={onCompress}
        disabled={compressing}
        title="Compress older turns into a summary to free up context"
        className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        <Icon name="archive" size={13} />
        <span className="hidden sm:inline">{compressing ? "Compressing…" : "Compress"}</span>
      </button>
    </div>
  );
}

function ComposerToggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${
        on
          ? "border-accent bg-accent/10 font-medium text-accent"
          : "border-line text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ArtifactCard({
  icon,
  label,
  sub,
  onClick,
  pulsing,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick?: () => void;
  pulsing?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`my-2 flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left shadow-sm ${
        onClick ? "hover:border-accent" : ""
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-muted ${
          pulsing ? "animate-pulse" : ""
        }`}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-muted">
          {sub} · click to open
        </span>
      </span>
    </button>
  );
}

function ThinkingBlock({
  text,
  live,
  durationMs,
}: {
  text: string;
  live?: boolean;
  durationMs?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const show = open || Boolean(live);
  const secs = durationMs != null ? Math.round(durationMs / 1000) : 0;
  const label = live
    ? "Thinking"
    : durationMs != null && durationMs > 0
      ? `Thought for ${secs < 1 ? "a moment" : `${secs}s`}`
      : "Thought process";
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group/think flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 ${live ? "animate-spin-slow text-accent" : "text-ink-muted"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a4 4 0 0 0-4 4 4 4 0 0 0-2 7 4 4 0 0 0 6 3 4 4 0 0 0 6-3 4 4 0 0 0-2-7 4 4 0 0 0-4-4Z" />
        </svg>
        <span className={live ? "shimmer-text" : ""}>{label}</span>
        <span className="text-[10px] opacity-60 transition-transform group-hover/think:opacity-100">
          {show ? "▴" : "▾"}
        </span>
      </button>
      {show && (
        <div className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap border-l-2 border-line pl-3 text-xs italic leading-relaxed text-ink-muted">
          {text}
        </div>
      )}
    </div>
  );
}

function Citations({ annotations }: { annotations: NonNullable<Message["annotations"]> }) {
  const seen = new Set<string>();
  const unique = annotations.filter((a) => {
    const url = a.url_citation?.url;
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (unique.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-muted">Sources:</span>
      {unique.map((a, i) => {
        const c = a.url_citation;
        let host = c.url;
        try {
          host = new URL(c.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep raw */
        }
        return (
          <a
            key={i}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={c.title || c.url}
            className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
          >
            {i + 1}. {host}
          </a>
        );
      })}
    </div>
  );
}

function Composer({
  disabled,
  isStreaming,
  onSend,
  onQueue,
  onStop,
  webSearch,
  onToggleWebSearch,
  think,
  onToggleThink,
  imageMode,
  onToggleImageMode,
  research,
  onToggleResearch,
  agentMode,
  onToggleAgentMode,
  modelSupportsImages,
}: {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  /** Called instead of onSend while a reply is still streaming. */
  onQueue: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  think: boolean;
  onToggleThink: () => void;
  imageMode: boolean;
  onToggleImageMode: () => void;
  research: boolean;
  onToggleResearch: () => void;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  modelSupportsImages: boolean;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [prompts, setPrompts] = useState<{ id: string; name: string; slug: string; body: string }[]>([]);
  const loadPrompts = () =>
    api<{ id: string; name: string; slug: string; body: string }[]>("/api/prompts")
      .then(setPrompts)
      .catch(() => {});
  useEffect(() => {
    loadPrompts();
  }, []);
  // Show the prompt menu when the composer holds a lone "/query" (a slash command).
  const slashMatch = /^\/(\S*)$/.exec(text);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const slashPrompts =
    slashQuery != null
      ? prompts.filter(
          (p) =>
            p.slug.includes(slashQuery) || p.name.toLowerCase().includes(slashQuery)
        )
      : [];
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Paste images/files anywhere on the page, and drag & drop onto the window —
  // matching ChatGPT/Claude behavior, not just the textarea.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        addFilesRef.current(e.clipboardData.files);
      }
    };
    let dragDepth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragDepth++;
        setDragging(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepth = 0;
      setDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        addFilesRef.current(e.dataTransfer.files);
      }
    };
    document.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [disabled]);

  // Cross-browser dictation: record with MediaRecorder, then transcribe via
  // OpenRouter (a multimodal model), rather than the Chrome-only Web Speech API.
  const toggleDictation = async () => {
    if (listening) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast("Voice dictation isn't supported in this browser.", "error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Microphone access was denied.", "error");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    audioChunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      const blob = new Blob(audioChunksRef.current, { type: rec.mimeType });
      if (blob.size === 0) return;
      setTranscribing(true);
      try {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(",")[1] ?? "";
        // "audio/webm;codecs=opus" -> "webm"
        const format = (rec.mimeType.split("/")[1] || "webm").split(";")[0];
        const { text: transcript } = await api<{ text: string }>("/api/transcribe", {
          method: "POST",
          body: JSON.stringify({ data: base64, format }),
        });
        if (transcript?.trim()) {
          setText((t) => (t ? t + " " : "") + transcript.trim());
          textareaRef.current?.focus();
        }
      } catch {
        toast("Transcription failed. Please try again.", "error");
      } finally {
        setTranscribing(false);
      }
    };
    mediaRecorderRef.current = rec;
    rec.start();
    setListening(true);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    // Clearing the box either way is deliberate: the message has been accepted,
    // and the pill above the composer is what says it is waiting rather than sent.
    if (isStreaming) onQueue(trimmed, attachments);
    else onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const converted = await Promise.all(Array.from(files).map(fileToUploadAttachment));
    setAttachments((a) => [...a, ...converted]);
  };
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  // "Ask to change" from the artifact panel prefills the composer.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") {
        setText((t) => (t ? t + "\n" + detail : detail));
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("liberde-prefill", onPrefill);
    return () => window.removeEventListener("liberde-prefill", onPrefill);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  return (
    <div className="composer-dock px-4">
      <div className="mx-auto max-w-3xl">
        {slashQuery != null && (
          <div className="mb-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-ink-muted">
              <span>Saved prompts</span>
              <button
                onClick={async () => {
                  const name = window.prompt("Prompt name:");
                  if (!name?.trim()) return;
                  const body = window.prompt("Prompt text:");
                  if (!body?.trim()) return;
                  await api("/api/prompts", {
                    method: "POST",
                    body: JSON.stringify({ name, body }),
                  });
                  await loadPrompts();
                }}
                className="hover:text-ink"
              >
                + New
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {slashPrompts.map((p) => (
                <div key={p.id} className="group flex items-center rounded-lg hover:bg-surface-2">
                  <button
                    onClick={() => {
                      setText(p.body);
                      textareaRef.current?.focus();
                    }}
                    className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                  >
                    <span className="text-sm font-medium">/{p.slug}</span>
                    <span className="ml-2 text-xs text-ink-muted">{p.name}</span>
                  </button>
                  <button
                    onClick={async () => {
                      await api(`/api/prompts?id=${p.id}`, { method: "DELETE" });
                      await loadPrompts();
                    }}
                    className="hidden px-2 text-xs text-ink-muted hover:text-red-500 group-hover:block"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {slashPrompts.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-ink-muted">
                  No saved prompts{slashQuery ? " match" : " yet"}. Use “+ New” to add one.
                </p>
              )}
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((a, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
              >
                {a.mime.startsWith("image/") && a.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.dataUrl}
                    alt={a.name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <Icon
                    name={
                      a.mime === "application/pdf" ||
                      a.mime === DOCX_MIME ||
                      a.mime === DOC_MIME
                        ? "filePdf"
                        : "fileText"
                    }
                    size={14}
                    className="shrink-0 text-ink-muted"
                  />
                )}
                <span className="max-w-40 truncate">{a.name}</span>
                <button
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  className="text-ink-muted hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
            {!modelSupportsImages &&
              attachments.some((a) => a.mime.startsWith("image/")) && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  The selected model can&apos;t see images — pick one marked with
                  the vision icon in the model list.
                </span>
              )}
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/30">
            <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-lg font-medium">
              Drop files to attach
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-surface shadow-sm focus-within:border-accent">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              disabled
                ? "Add your OpenRouter API key in Settings to start…"
                : imageMode
                  ? "Describe the image to generate…"
                  : "Message Liberde…"
            }
            rows={1}
            disabled={disabled}
            className="w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-ink-muted disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <button
                title="Attach files"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                className="shrink-0 rounded-lg px-2 py-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <Icon name="paperclip" />
              </button>
              <ComposerToggle
                on={webSearch}
                onClick={onToggleWebSearch}
                title="Search the web and cite sources"
              >
                <Icon name="globe" size={14} /> Search
              </ComposerToggle>
              <ComposerToggle
                on={think}
                onClick={onToggleThink}
                title="Extended thinking (reasoning models)"
              >
                <Icon name="brain" size={14} /> Think
              </ComposerToggle>
              <ComposerToggle
                on={imageMode}
                onClick={onToggleImageMode}
                title="Generate an image from your prompt"
              >
                <Icon name="image" size={14} /> Image
              </ComposerToggle>
              <ComposerToggle
                on={research}
                onClick={onToggleResearch}
                title="Deep research: multiple web searches synthesized into a cited report"
              >
                <Icon name="flask" size={14} /> Research
              </ComposerToggle>
              <ComposerToggle
                on={agentMode}
                onClick={onToggleAgentMode}
                title="Plan: breaks your goal into steps, executes each with tools, and delivers the result"
              >
                <Icon name="sparkles" size={14} /> Plan
              </ComposerToggle>
              <button
                title={
                  listening
                    ? "Stop recording"
                    : transcribing
                      ? "Transcribing…"
                      : "Dictate with your voice"
                }
                onClick={toggleDictation}
                disabled={disabled || transcribing}
                className={`shrink-0 rounded-lg px-2 py-1.5 disabled:opacity-50 ${
                  listening
                    ? "animate-pulse bg-accent text-white"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Icon name={transcribing ? "refresh" : "mic"} className={transcribing ? "animate-spin" : undefined} />
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept="image/*,.pdf,.docx,.doc,.mht,.mhtml,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.cs,.go,.rs,.rb,.yaml,.yml,.toml,.sql,.sh,.ps1,.log"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {isStreaming ? (
              <button
                onClick={onStop}
                title="Stop"
                className="tap-target flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
              >
                <Icon name="stop" size={14} /> Stop
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!text.trim() || disabled}
                title="Send"
                className="tap-target flex shrink-0 items-center justify-center rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Icon name="arrowUp" size={18} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-muted">
          Enter to send · Shift+Enter for a new line · paste images directly
        </p>
      </div>
    </div>
  );
}
