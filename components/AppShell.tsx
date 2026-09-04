"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, Conversation, ModelInfo, Project } from "@/lib/types";
import { api } from "@/lib/client";
import Sidebar from "./Sidebar";
import ChatView from "./ChatView";
import ProjectPanel from "./ProjectPanel";
import SettingsDialog from "./SettingsDialog";
import TasksDialog from "./TasksDialog";
import ModelsPanel from "./ModelsPanel";
import UsagePanel from "./UsagePanel";
import ArtifactGallery from "./ArtifactGallery";
import HelpPanel from "./HelpPanel";
import CommandPalette from "./CommandPalette";
import UiHost from "./UiHost";
import Icon from "./Icon";

export type View =
  | { kind: "chat"; conversationId: string | null }
  | { kind: "project"; projectId: string }
  | { kind: "models" }
  | { kind: "usage" }
  | { kind: "artifacts" }
  | { kind: "help" };

function viewToPath(view: View): string {
  if (view.kind === "project") return `/projects/${view.projectId}`;
  if (view.kind === "models") return "/models";
  if (view.kind === "usage") return "/usage";
  if (view.kind === "artifacts") return "/artifacts";
  if (view.kind === "help") return "/help";
  return view.conversationId ? `/c/${view.conversationId}` : "/";
}

function pathToView(path: string): View {
  const project = path.match(/^\/projects\/([^/]+)/);
  if (project) return { kind: "project", projectId: project[1] };
  if (/^\/models/.test(path)) return { kind: "models" };
  if (/^\/usage/.test(path)) return { kind: "usage" };
  if (/^\/artifacts/.test(path)) return { kind: "artifacts" };
  if (/^\/help/.test(path)) return { kind: "help" };
  const chat = path.match(/^\/c\/([^/]+)/);
  return { kind: "chat", conversationId: chat ? chat[1] : null };
}

export default function AppShell({ initialView }: { initialView: View }) {
  const [view, setViewState] = useState<View>(initialView);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [booted, setBooted] = useState(false);
  const [workspace, setWorkspace] = useState<"chat" | "design">("chat");
  // Once the user picks a workspace, the async mount-time mode sync (which
  // reads the opened conversation's mode) must not stomp their choice.
  const workspacePicked = useRef(false);

  const setView = useCallback((next: View) => {
    setViewState(next);
    window.history.pushState(null, "", viewToPath(next));
    // On phones the sidebar is an overlay — close it once you navigate.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversations(await api<Conversation[]>(`/api/conversations?mode=${workspace}`));
  }, [workspace]);

  const refreshProjects = useCallback(async () => {
    setProjects(await api<Project[]>("/api/projects"));
  }, []);

  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  // Start collapsed on phones so the chat isn't hidden behind the sidebar on
  // load. (Done post-mount to avoid an SSR/hydration mismatch.)
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    // Load the essentials before revealing the app, so it doesn't flash empty.
    (async () => {
      const authP = fetch("/api/auth")
        .then((r) => r.json())
        .then((d) => {
          // Multi-user gate: once accounts exist, an unauthenticated visitor → /login.
          if (d.authRequired && !d.user) {
            window.location.href = "/login";
            return "redirect";
          }
          if (d.user) setMe(d.user);
        })
        .catch(() => {});
      await Promise.allSettled([
        authP,
        refreshConversations(),
        refreshProjects(),
        api<AppSettings>("/api/settings").then(setSettings),
      ]);
      setBooted(true);
    })();
    // Models can be slower (upstream) — load them without blocking the reveal.
    api<ModelInfo[]>("/api/models").then(setModels).catch(() => {});
    const onPop = () => setViewState(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPop);
    // Deep-link into a settings tab from anywhere (e.g. the design-system chip's
    // "+ New design system…" jumps straight to Settings → Design systems).
    const onOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      setSettingsTab(detail?.tab);
      setSettingsOpen(true);
    };
    window.addEventListener("liberde:open-settings", onOpenSettings);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // Keyboard shortcuts: Ctrl+Shift+O new chat, Ctrl+K focus search (ChatGPT parity).
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setView({ kind: "chat", conversationId: null });
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("liberde:open-settings", onOpenSettings);
    };
    // Boot once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a hard load of /c/<id>, sync the workspace to that conversation's mode
  // so a design conversation reopens in the Design workspace instead of
  // snapping back to Chat on refresh.
  useEffect(() => {
    if (initialView.kind !== "chat" || !initialView.conversationId) return;
    let cancelled = false;
    api<Conversation>(`/api/conversations/${initialView.conversationId}`)
      .then((c) => {
        if (!cancelled && !workspacePicked.current && c?.mode === "design") {
          setWorkspace("design");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once for the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch the conversation list when the workspace (Chat/Design) changes.
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // First-run: greet new users with a welcome + tour (and a clear path to add
  // their API key) instead of dumping them straight into Settings.
  //
  // Dismissal has to persist. The condition is 'no API key yet', which stays
  // true until they add one — so without remembering the dismissal the tour
  // came back on every single navigation, and Skip meant 'skip until you click
  // anything'.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!settings || settings.hasApiKey) return;
    let seen = false;
    try {
      seen = localStorage.getItem(WELCOME_SEEN) === '1';
    } catch {
      // Private windows and blocked site data throw on access; showing the
      // tour once per session is a better failure than crashing the shell.
    }
    if (!seen) setShowWelcome(true);
  }, [settings]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      localStorage.setItem(WELCOME_SEEN, '1');
    } catch {
      /* nothing to do — it simply shows again next time */
    }
  }, []);

  if (!booted) return <BootSplash />;

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <UiHost />
      {/* Tap-to-dismiss backdrop behind the mobile sidebar overlay. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        conversations={conversations}
        projects={projects}
        view={view}
        workspace={workspace}
        onWorkspaceChange={(w) => {
          workspacePicked.current = true;
          setWorkspace(w);
          setView({ kind: "chat", conversationId: null });
        }}
        onSelect={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTasks={() => setTasksOpen(true)}
        me={me}
        onLogout={async () => {
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "logout" }),
          });
          window.location.href = "/login";
        }}
        onConversationsChanged={refreshConversations}
        onProjectsChanged={refreshProjects}
      />

      <main className="flex min-w-0 flex-1">
        {/* Mobile: non-chat views (models/usage/help/project) get a floating
            hamburger to reopen the sidebar, since the slim rail is hidden on
            mobile and only ChatView has its own in-header hamburger. */}
        {view.kind !== "chat" && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Open menu"
            className="absolute left-3 top-3 z-20 rounded-lg border border-line bg-surface-2 p-1.5 text-ink-muted shadow-sm md:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
        )}
        {view.kind === "chat" ? (
          <ChatView
            key={workspace}
            conversationId={view.conversationId}
            models={models}
            settings={settings}
            projects={projects}
            mode={workspace}
            onConversationCreated={(c) => {
              setView({ kind: "chat", conversationId: c.id });
              refreshConversations();
            }}
            onConversationsChanged={refreshConversations}
            onOpenSidebar={() => setSidebarOpen(true)}
            userName={me?.name}
          />
        ) : view.kind === "models" ? (
          <ModelsPanel
            models={models}
            settings={settings}
            onStartChat={async (modelId) => {
              const conv = await api<Conversation>("/api/conversations", {
                method: "POST",
                body: JSON.stringify({ model: modelId }),
              });
              await refreshConversations();
              setView({ kind: "chat", conversationId: conv.id });
            }}
            onDefaultChanged={setSettings}
          />
        ) : view.kind === "artifacts" ? (
          <ArtifactGallery
            onOpen={(conversationId) => setView({ kind: "chat", conversationId })}
            onOpenCopy={(conversationId) => {
              // A copy of someone else's artifact is a design conversation, so it
              // lands in the Design workspace the same way the old dialog did.
              setWorkspace("design");
              refreshConversations();
              setView({ kind: "chat", conversationId });
            }}
            onClose={() => setView({ kind: "chat", conversationId: null })}
          />
        ) : view.kind === "usage" ? (
          <UsagePanel />
        ) : view.kind === "help" ? (
          <HelpPanel />
        ) : (
          <ProjectPanel
            key={view.projectId}
            projectId={view.projectId}
            onOpenConversation={(id) => setView({ kind: "chat", conversationId: id })}
            onNewChatInProject={async (projectId) => {
              const conv = await api<Conversation>("/api/conversations", {
                method: "POST",
                body: JSON.stringify({ projectId }),
              });
              await refreshConversations();
              setView({ kind: "chat", conversationId: conv.id });
            }}
            onProjectsChanged={refreshProjects}
            onDeleted={() => setView({ kind: "chat", conversationId: null })}
          />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        conversations={conversations}
        projects={projects}
        models={models}
        actions={{
          newChat: () => setView({ kind: "chat", conversationId: null }),
          goModels: () => setView({ kind: "models" }),
          goUsage: () => setView({ kind: "usage" }),
          goArtifacts: () => setView({ kind: "artifacts" }),
          openTasks: () => setTasksOpen(true),
          openSettings: () => setSettingsOpen(true),
          openChat: (id) => setView({ kind: "chat", conversationId: id }),
          openProject: (id) => setView({ kind: "project", projectId: id }),
          newChatWithModel: async (modelId) => {
            const conv = await api<Conversation>("/api/conversations", {
              method: "POST",
              body: JSON.stringify({ model: modelId }),
            });
            await refreshConversations();
            setView({ kind: "chat", conversationId: conv.id });
          },
        }}
      />

      {tasksOpen && (
        <TasksDialog
          onClose={() => setTasksOpen(false)}
          onOpenConversation={(id) => {
            refreshConversations();
            setView({ kind: "chat", conversationId: id });
          }}
        />
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          models={models}
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          onSaved={(s) => setSettings(s)}
        />
      )}


      {showWelcome && (
        <WelcomeTour
          hasKey={Boolean(settings?.hasApiKey)}
          onAddKey={() => {
            dismissWelcome();
            setSettingsOpen(true);
          }}
          onClose={dismissWelcome}
        />
      )}
    </div>
  );
}

function BootSplash() {
  return (
    <div className="grid h-dvh place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="login-logo grid h-16 w-16 place-items-center rounded-2xl bg-accent font-display text-4xl font-bold text-white shadow-lg">
          L
        </div>
        <span className="shimmer-text font-display text-xl font-semibold">Liberde</span>
      </div>
    </div>
  );
}

const TOUR_STEPS = [
  {
    icon: "message",
    title: "Chat with any model",
    body: "Talk to Claude, GPT, Gemini, Grok and hundreds more through one interface. Switch models mid-conversation — your full history carries over.",
  },
  {
    icon: "sparkles",
    title: "Not sure which model? Ask.",
    body: "Hit “Help me pick” next to the model selector, describe what you're doing, and Liberde recommends the right model — and can set it as your default.",
  },
  {
    icon: "wrench",
    title: "Connectors & Skills",
    body: "Add MCP servers in Settings → Connectors to give the model real tools. Then train Skills that bundle those tools for repeatable jobs.",
  },
  {
    icon: "brain",
    title: "Agent, Research & Projects",
    body: "Toggle Agent or Research mode for multi-step work, and group chats into Projects with their own knowledge and instructions.",
  },
] as const;

/** Remembers that the tour was dismissed, so Skip means skip. */
const WELCOME_SEEN = "liberde-welcome-seen";

function WelcomeTour({
  hasKey,
  onAddKey,
  onClose,
}: {
  hasKey: boolean;
  onAddKey: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const last = step >= TOUR_STEPS.length - 1;
  const s = TOUR_STEPS[step];

  // Escape closes the tour, and clicking the backdrop does too. Every other
  // overlay in the app already behaves this way; this one trapped a new user
  // until they found the Skip link, which is the first thing they see and the
  // last thing they read.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Icon name={s.icon} size={26} />
          </div>
          <h2 className="font-display text-2xl font-semibold">
            {step === 0 ? "Welcome to Liberde" : s.title}
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">{s.body}</p>

          {!hasKey && (
            <div className="mt-1 w-full rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-left text-sm">
              <p className="font-medium">One thing first: add your OpenRouter key</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Liberde uses your own OpenRouter key to talk to models. Get one at
                openrouter.ai/keys, then paste it in Settings and hit Verify.
              </p>
              <button
                onClick={onAddKey}
                className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Add API key →
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <div className="flex gap-1.5">
            {TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-accent" : "bg-line"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
            >
              Skip
            </button>
            {step > 0 && (
              <button
                onClick={() => setStep((v) => v - 1)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? onClose() : setStep((v) => v + 1))}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              {last ? "Get started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
