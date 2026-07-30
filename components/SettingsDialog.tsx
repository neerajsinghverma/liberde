"use client";

import { confirmDialog } from "@/lib/ui";
import { useEffect, useState } from "react";
import type { AppSettings, ModelInfo, HttpTool, HttpToolParam } from "@/lib/types";
import { api, fileToUploadAttachment } from "@/lib/client";
import Icon from "./Icon";

interface PlatformKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  key?: string;
}

/**
 * Account + email-verification status. Soft verification: we surface the state
 * here (never a blocking banner). Shows the signed-in email and, when email is
 * configured but the address isn't yet confirmed, a one-tap resend.
 */
function AccountStatus() {
  const [state, setState] = useState<{
    email: string;
    verified: boolean;
    emailEnabled: boolean;
  } | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setState({
            email: d.user.email ?? "",
            verified: Boolean(d.user.emailVerified),
            emailEnabled: Boolean(d.emailEnabled),
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!state || !state.email) return null;

  const resend = async () => {
    setBusy(true);
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resend-verification", email: state.email }),
    }).catch(() => {});
    setBusy(false);
    setSent(true);
  };

  const showResend = state.emailEnabled && !state.verified;

  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{state.email}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            {state.verified ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Email verified
              </span>
            ) : (
              <span className="text-ink-muted">Email not verified</span>
            )}
          </div>
        </div>
        {showResend &&
          (sent ? (
            <span className="shrink-0 text-xs text-ink-muted">Sent — check your inbox</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? "…" : "Verify email"}
            </button>
          ))}
      </div>
    </div>
  );
}

type SettingsTabId =
  | "general"
  | "personalization"
  | "providers"
  | "connectors"
  | "http-tools"
  | "skills"
  | "prompts"
  | "design-systems"
  | "keys"
  | "admin";

// Tab rail config (Claude-style): grouped, icon'd, with search keywords so the
// search box can match on more than the visible label.
const SETTINGS_TABS: {
  id: SettingsTabId;
  label: string;
  icon: string;
  group: "Settings" | "Customize";
  keywords: string;
}[] = [
  { id: "general", label: "General", icon: "settings", group: "Settings", keywords: "model default title image transcribe temperature budget appearance theme api key openrouter" },
  { id: "personalization", label: "Personal", icon: "star", group: "Settings", keywords: "about you name style instructions memory recall past chats push notifications response" },
  { id: "providers", label: "Providers", icon: "wrench", group: "Settings", keywords: "azure bedrock aws google gemini vertex custom openai compatible groq ollama endpoint clouds" },
  { id: "keys", label: "Keys", icon: "key", group: "Settings", keywords: "api platform key cli token v1 external apps" },
  { id: "admin", label: "Admin", icon: "users", group: "Settings", keywords: "users signups accounts members administration" },
  { id: "connectors", label: "Connectors", icon: "globe", group: "Customize", keywords: "mcp server tools deepwiki context7 remote http stdio" },
  { id: "http-tools", label: "Custom tools", icon: "wrench", group: "Customize", keywords: "http rest api tool endpoint openapi swagger custom function call get post" },
  { id: "skills", label: "Skills", icon: "book", group: "Customize", keywords: "skill instructions reusable" },
  { id: "prompts", label: "Prompts", icon: "message", group: "Customize", keywords: "prompt template saved snippet" },
  { id: "design-systems", label: "Design systems", icon: "palette", group: "Customize", keywords: "brand colors palette typography fonts design system style guide share" },
];

export default function SettingsDialog({
  settings,
  models,
  onClose,
  onSaved,
  initialTab,
}: {
  settings: AppSettings;
  models: ModelInfo[];
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState<SettingsTabId>(
    SETTINGS_TABS.some((t) => t.id === initialTab)
      ? (initialTab as SettingsTabId)
      : "general"
  );
  const [tabSearch, setTabSearch] = useState("");
  // The Admin tab is admin-only. (The /api/admin routes enforce this server-side
  // too — this just hides the tab so non-admins don't see a dead panel.)
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setIsAdmin(Boolean(d.user?.isAdmin)))
      .catch(() => {});
  }, []);
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [titleModel, setTitleModel] = useState(settings.titleModel);
  const [imageModel, setImageModel] = useState(settings.imageModel ?? "");
  const [transcribeModel, setTranscribeModel] = useState(settings.transcribeModel ?? "");
  const [plannerModel, setPlannerModel] = useState(settings.plannerModel ?? "");
  const [agentExecModel, setAgentExecModel] = useState(settings.agentExecModel ?? "");
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [aboutUser, setAboutUser] = useState(settings.aboutUser ?? "");
  const [styleInstructions, setStyleInstructions] = useState(
    settings.styleInstructions ?? ""
  );
  const [responseStyle, setResponseStyle] = useState(settings.responseStyle ?? "normal");
  const [memoryEnabled, setMemoryEnabled] = useState(settings.memoryEnabled ?? true);
  const [recallEnabled, setRecallEnabled] = useState(settings.recallEnabled ?? true);
  const [memories, setMemories] = useState<
    { id: string; content: string; created_at: number }[]
  >([]);
  const [editingMemId, setEditingMemId] = useState<string | null>(null);
  const [editingMemText, setEditingMemText] = useState("");
  const [newMemText, setNewMemText] = useState("");
  const [temperature, setTemperature] = useState(settings.temperature);
  const [saving, setSaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState<
    "checking" | { ok: boolean; msg: string } | null
  >(null);
  const [platformKeys, setPlatformKeys] = useState<PlatformKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<PlatformKey | null>(null);

  useEffect(() => {
    api<PlatformKey[]>("/api/keys").then(setPlatformKeys).catch(() => {});
    api<{ id: string; content: string; created_at: number }[]>("/api/memories")
      .then(setMemories)
      .catch(() => {});
  }, []);

  const removeMemory = async (id: string) => {
    await api(`/api/memories?id=${id}`, { method: "DELETE" });
    setMemories((m) => m.filter((x) => x.id !== id));
  };

  const saveMemoryEdit = async (id: string) => {
    const content = editingMemText.trim();
    setEditingMemId(null);
    if (!content) return;
    await api("/api/memories", { method: "PATCH", body: JSON.stringify({ id, content }) });
    setMemories((m) => m.map((x) => (x.id === id ? { ...x, content } : x)));
  };

  const addMemoryManual = async () => {
    const content = newMemText.trim();
    if (!content) return;
    setNewMemText("");
    const created = await api<{ id: string; content: string; created_at: number }>(
      "/api/memories",
      { method: "POST", body: JSON.stringify({ content }) }
    );
    setMemories((m) => [...m, created]);
  };

  const verifyKey = async () => {
    setKeyStatus("checking");
    try {
      const r = await api<{ valid: boolean; label?: string | null; error?: string }>(
        "/api/verify-key",
        { method: "POST", body: JSON.stringify({ key: apiKey.trim() }) }
      );
      setKeyStatus(
        r.valid
          ? { ok: true, msg: `Valid key${r.label ? ` — ${r.label}` : ""}. Remember to Save.` }
          : { ok: false, msg: r.error || "This key was rejected." }
      );
    } catch (e) {
      setKeyStatus({ ok: false, msg: e instanceof Error ? e.message : "Could not verify." });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api<AppSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey } : {}),
          defaultModel,
          titleModel,
          imageModel,
          transcribeModel,
          plannerModel,
          agentExecModel,
          systemPrompt,
          aboutUser,
          styleInstructions,
          responseStyle,
          memoryEnabled,
          recallEnabled,
          temperature,
        }),
      });
      onSaved(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const createKey = async () => {
    const created = await api<PlatformKey>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: newKeyName || "Unnamed key" }),
    });
    setFreshKey(created);
    setNewKeyName("");
    setPlatformKeys(await api<PlatformKey[]>("/api/keys"));
  };

  const deleteKey = async (id: string) => {
    if (!(await confirmDialog("Revoke this API key? Apps using it will stop working."))) return;
    await api(`/api/keys?id=${id}`, { method: "DELETE" });
    setPlatformKeys(await api<PlatformKey[]>("/api/keys"));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[68vh] max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl max-md:h-[85vh] max-md:flex-col">
        {/* Tab rail — left sidebar on desktop, scrollable top bar on mobile */}
        <div className="flex shrink-0 flex-col border-line md:w-56 md:border-r max-md:border-b">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="font-display text-lg font-semibold">Settings</h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink md:hidden">✕</button>
          </div>
          {/* Search (desktop) — filter/jump to a section */}
          <div className="hidden px-3 pb-2 md:block">
            <input
              value={tabSearch}
              onChange={(e) => setTabSearch(e.target.value)}
              placeholder="Search settings…"
              className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:min-h-0 md:flex-col md:gap-0.5 md:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(() => {
              const q = tabSearch.trim().toLowerCase();
              const shown = SETTINGS_TABS.filter(
                (t) =>
                  (t.id !== "admin" || isAdmin) &&
                  (!q || t.label.toLowerCase().includes(q) || t.keywords.includes(q))
              );
              return shown.map((t, i) => {
                const showGroup = !q && (i === 0 || shown[i - 1].group !== t.group);
                return (
                  <div key={t.id} className="contents">
                    {showGroup && (
                      <div className="mt-2 hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted first:mt-0 md:block">
                        {t.group}
                      </div>
                    )}
                    <button
                      onClick={() => setTab(t.id)}
                      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm md:w-full ${
                        tab === t.id
                          ? "bg-surface-2 font-medium text-ink"
                          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink"
                      }`}
                    >
                      <Icon name={t.icon} size={15} /> {t.label}
                    </button>
                  </div>
                );
              });
            })()}
          </nav>
        </div>

        {/* Content pane */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <button
            onClick={onClose}
            title="Close"
            className="absolute right-4 top-4 z-10 hidden text-ink-muted hover:text-ink md:block"
          >
            ✕
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "general" ? (
            <div className="space-y-5">
              <Field
                label="OpenRouter API key"
                hint={
                  settings.hasApiKey
                    ? "A key is configured. Enter a new one to replace it."
                    : "Required. Get one at openrouter.ai/keys"
                }
              >
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyStatus(null);
                    }}
                    placeholder={settings.hasApiKey ? "••••••••••••••••" : "sk-or-v1-…"}
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={verifyKey}
                    disabled={!apiKey.trim() || keyStatus === "checking"}
                    className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-40"
                  >
                    {keyStatus === "checking" ? "Checking…" : "Verify"}
                  </button>
                </div>
                {keyStatus && keyStatus !== "checking" && (
                  <p
                    className={`mt-1.5 text-xs ${
                      keyStatus.ok ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {keyStatus.msg}
                  </p>
                )}
              </Field>

              <Field label="Default model" hint="Used for new chats.">
                <ModelSelect models={models} value={defaultModel} onChange={setDefaultModel} allowAuto />
              </Field>

              <Field
                label="Title model"
                hint="Small, cheap model used to auto-name conversations."
              >
                <ModelSelect models={models} value={titleModel} onChange={setTitleModel} />
              </Field>

              <Field
                label="Planner model (optional)"
                hint="Cheap model that plans 🤖 Agent and 🔬 Research runs, and powers the “Draft with AI” helpers (Skills, Design systems). Blank = title model for drafting, the chat's model elsewhere."
              >
                <ModelSelect models={models} value={plannerModel} onChange={setPlannerModel} />
              </Field>

              <Field
                label="Agent executor model (optional)"
                hint="Runs the agent's individual steps (tool calls, research legwork) — a mid-tier model here saves a lot. Blank = use the chat's model; the final deliverable always uses the chat's model."
              >
                <ModelSelect
                  models={models}
                  value={agentExecModel}
                  onChange={setAgentExecModel}
                />
              </Field>

              <Field
                label="Image model"
                hint="Used by the 🎨 Image composer toggle (must support image output)."
              >
                <input
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  placeholder="google/gemini-2.5-flash-image"
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>

              <Field
                label="Dictation model"
                hint="Audio-capable model used to transcribe voice dictation via OpenRouter. Must accept audio input (e.g. Gemini or GPT-4o-audio)."
              >
                <ModelSelect
                  models={models}
                  value={transcribeModel}
                  onChange={setTranscribeModel}
                />
              </Field>

              <Field
                label="System prompt"
                hint="Prepended to every conversation. Leave blank for none."
              >
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>

              <Field label={`Temperature: ${temperature.toFixed(1)}`}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-(--color-accent)"
                />
              </Field>

            </div>
          ) : tab === "personalization" ? (
            <div className="space-y-5">
              <AccountStatus />
              <Field
                label="About you"
                hint="Shared with the model in every chat — name, role, context that helps it help you."
              >
                <textarea
                  value={aboutUser}
                  onChange={(e) => setAboutUser(e.target.value)}
                  rows={3}
                  placeholder="e.g. I'm Nikhil, a solutions engineer. I work mostly in TypeScript and Next.js."
                  className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>

              <Field
                label="Response style"
                hint="A quick preset applied to every chat. Combine with your own instructions below."
              >
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["normal", "Normal"],
                    ["concise", "Concise"],
                    ["explanatory", "Explanatory"],
                    ["formal", "Formal"],
                    ["learning", "Learning"],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setResponseStyle(v)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        responseStyle === v
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line text-ink-muted hover:bg-surface-2"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="Custom instructions"
                hint="Extra tone/format preferences applied to every chat, on top of the style above."
              >
                <textarea
                  value={styleInstructions}
                  onChange={(e) => setStyleInstructions(e.target.value)}
                  rows={3}
                  placeholder="e.g. Be concise. Prefer code over prose. Skip pleasantries."
                  className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={memoryEnabled}
                    onChange={(e) => setMemoryEnabled(e.target.checked)}
                    className="accent-(--color-accent)"
                  />
                  Memory
                </label>
                <p className="mt-1 text-xs text-ink-muted">
                  When on, the model can save durable facts from your chats and recalls
                  them everywhere (never in temporary chats).
                </p>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={recallEnabled}
                    onChange={(e) => setRecallEnabled(e.target.checked)}
                    className="accent-(--color-accent)"
                  />
                  Search past chats
                </label>
                <p className="mt-1 text-xs text-ink-muted">
                  When on, the assistant can search your own previous conversations to
                  recall earlier context or facts about you (e.g. &ldquo;who am I?&rdquo;).
                </p>
              </div>

              <PushToggle />

              <div className="divide-y divide-line rounded-lg border border-line">
                {memories.map((m) => (
                  <div key={m.id} className="px-3 py-2 text-sm">
                    {editingMemId === m.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editingMemText}
                          onChange={(e) => setEditingMemText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveMemoryEdit(m.id);
                            if (e.key === "Escape") setEditingMemId(null);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                        />
                        <button
                          onClick={() => saveMemoryEdit(m.id)}
                          className="shrink-0 text-xs font-medium text-accent hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingMemId(null)}
                          className="shrink-0 text-xs text-ink-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="group flex items-start justify-between gap-3">
                        <span className="min-w-0 flex-1">{m.content}</span>
                        <span className="flex shrink-0 gap-2">
                          <button
                            onClick={() => {
                              setEditingMemId(m.id);
                              setEditingMemText(m.content);
                            }}
                            className="text-xs text-ink-muted hover:text-ink"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => removeMemory(m.id)}
                            className="text-xs text-ink-muted hover:text-red-500"
                          >
                            Forget
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {memories.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-ink-muted">
                    Nothing remembered yet. Add one below, or let it fill in as you chat.
                  </p>
                )}
                <div className="flex items-center gap-2 px-3 py-2">
                  <input
                    value={newMemText}
                    onChange={(e) => setNewMemText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addMemoryManual()}
                    placeholder="Add a memory (e.g. I prefer metric units)"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                  <button
                    onClick={addMemoryManual}
                    disabled={!newMemText.trim()}
                    className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : tab === "admin" ? (
            <AdminTab />
          ) : tab === "providers" ? (
            <ProvidersTab />
          ) : tab === "connectors" ? (
            <ConnectorsTab />
          ) : tab === "http-tools" ? (
            <HttpToolsTab />
          ) : tab === "skills" ? (
            <SkillsTab models={models} />
          ) : tab === "prompts" ? (
            <PromptsTab />
          ) : tab === "design-systems" ? (
            <DesignSystemsTab models={models} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                Platform keys let external apps (the Liberde CLI, your own code) call
                this server&apos;s OpenAI-compatible API at{" "}
                <code className="rounded bg-surface-2 px-1">/v1/chat/completions</code>.
              </p>

              <div className="flex gap-2">
                <input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. CLI on laptop)"
                  className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  onClick={createKey}
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Create key
                </button>
              </div>

              {freshKey?.key && (
                <div className="rounded-lg border border-accent bg-surface-2 p-3 text-sm">
                  <p className="mb-1 font-medium">
                    Copy this key now — it won&apos;t be shown again:
                  </p>
                  <code className="break-all text-xs">{freshKey.key}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(freshKey.key!)}
                    className="ml-2 text-xs text-accent hover:underline"
                  >
                    Copy
                  </button>
                </div>
              )}

              <div className="divide-y divide-line rounded-lg border border-line">
                {platformKeys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{k.name}</span>{" "}
                      <span className="text-xs text-ink-muted">{k.key_prefix}…</span>
                      <p className="text-xs text-ink-muted">
                        Created {new Date(k.created_at).toLocaleDateString()}
                        {k.last_used_at
                          ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
                          : " · never used"}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteKey(k.id)}
                      className="text-xs text-ink-muted hover:text-red-500"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
                {platformKeys.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-ink-muted">
                    No platform keys yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function AdminTab() {
  const [data, setData] = useState<{
    users: {
      id: string;
      email: string;
      name: string;
      is_admin: number;
      created_at: number;
      locked_until?: number;
      auth_provider?: string;
    }[];
    allowSignups: boolean;
    me: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<{ email: string; password: string } | null>(null);

  const load = async () => {
    try {
      setData(await api<NonNullable<typeof data>>("/api/admin"));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="text-sm text-ink-muted">{error}</p>;
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      {resetInfo && (
        <div className="rounded-xl border border-(--color-accent) bg-(--color-accent)/10 px-3 py-2 text-sm">
          <div className="font-medium">Temporary password for {resetInfo.email}</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-surface-2 px-2 py-1 font-mono text-xs">{resetInfo.password}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(resetInfo.password)}
              className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
            >
              Copy
            </button>
            <button
              onClick={() => setResetInfo(null)}
              className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
            >
              Done
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Send this to the user over a trusted channel. It won&apos;t be shown again, their other
            sessions are signed out, and they should change it after signing in.
          </p>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={data.allowSignups}
          onChange={async (e) => {
            await api("/api/admin", {
              method: "PATCH",
              body: JSON.stringify({ allowSignups: e.target.checked }),
            });
            await load();
          }}
          className="accent-(--color-accent)"
        />
        Allow new signups
      </label>

      <div className="divide-y divide-line rounded-xl border border-line">
        {data.users.map((u) => (
          <div key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{u.name}</span>{" "}
              <span className="text-xs text-ink-muted">{u.email}</span>
              {Boolean(u.is_admin) && (
                <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium">ADMIN</span>
              )}
              {u.auth_provider === "google" && (
                <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-muted">GOOGLE</span>
              )}
              {Boolean(u.locked_until && u.locked_until > Date.now()) && (
                <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-500">
                  LOCKED
                </span>
              )}
            </div>
            {Boolean(u.locked_until && u.locked_until > Date.now()) && (
              <button
                onClick={async () => {
                  await api("/api/admin", {
                    method: "PATCH",
                    body: JSON.stringify({ unlockUserId: u.id }),
                  });
                  await load();
                }}
                className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
              >
                Unlock
              </button>
            )}
            {u.id !== data.me && (
              <>
                <button
                  onClick={async () => {
                    await api("/api/admin", {
                      method: "PATCH",
                      body: JSON.stringify({ userId: u.id, isAdmin: !u.is_admin }),
                    });
                    await load();
                  }}
                  className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
                >
                  {u.is_admin ? "Demote" : "Make admin"}
                </button>
                {u.auth_provider !== "google" && (
                  <button
                    onClick={async () => {
                      if (!(await confirmDialog(`Reset ${u.email}'s password? This signs them out everywhere and gives you a one-time temp password to send them.`))) return;
                      const r = await api<{ tempPassword: string }>("/api/admin", {
                        method: "PATCH",
                        body: JSON.stringify({ resetUserId: u.id }),
                      });
                      setResetInfo({ email: u.email, password: r.tempPassword });
                      await load();
                    }}
                    className="rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2"
                  >
                    Reset pw
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (!(await confirmDialog(`Delete ${u.email} and ALL their data?`))) return;
                    await api(`/api/admin?userId=${u.id}`, { method: "DELETE" });
                    await load();
                  }}
                  className="rounded border border-line px-2 py-0.5 text-xs text-red-500 hover:bg-surface-2"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        Deleting a user permanently removes their chats, projects, memory, keys, and settings.
      </p>
    </div>
  );
}

interface ProviderRow {
  id: string;
  kind: "openai" | "anthropic" | "azure" | "bedrock" | "google" | "custom";
  name: string;
  enabled: number;
  endpoint: string | null;
  region: string | null;
  models: string[];
  hasApiKey: boolean;
}

const PROVIDER_KINDS = [
  ["openai", "OpenAI (direct)"],
  ["anthropic", "Anthropic (direct)"],
  ["azure", "Azure AI Foundry"],
  ["bedrock", "AWS Bedrock"],
  ["google", "Google (Gemini / Vertex)"],
  ["custom", "Custom OpenAI-compatible"],
] as const;

function ProvidersTab() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [kind, setKind] = useState<ProviderRow["kind"]>("azure");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [apiVersion, setApiVersion] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [promptPrice, setPromptPrice] = useState("");
  const [completionPrice, setCompletionPrice] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => setProviders(await api<ProviderRow[]>("/api/providers"));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError(null);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({
          kind,
          name,
          endpoint,
          region,
          apiVersion,
          apiKey,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          models: modelsText,
          promptPrice,
          completionPrice,
        }),
      });
      setName("");
      setApiKey("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setModelsText("");
      setPromptPrice("");
      setCompletionPrice("");
      await load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const test = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: "testing…" }));
    const res = await api<{ ok: boolean; error?: string }>("/api/providers", {
      method: "PATCH",
      body: JSON.stringify({ id, action: "test" }),
    });
    setStatus((s) => ({ ...s, [id]: res.ok ? "✓ reachable" : `✗ ${res.error}` }));
  };

  const placeholderModels =
    kind === "azure"
      ? "Deployment names, comma-separated (e.g. gpt-4o, o3-mini)"
      : kind === "bedrock"
        ? "Model ids (e.g. anthropic.claude-sonnet-4-20250514-v1:0)"
        : kind === "google"
          ? "Model names (e.g. gemini-2.5-pro, gemini-3.1-flash)"
          : kind === "openai"
            ? "Model names (e.g. gpt-4o, gpt-4o-mini, o3-mini)"
            : kind === "anthropic"
              ? "Model names (e.g. claude-opus-4-20250514, claude-sonnet-4-20250514)"
              : "Model names your endpoint serves";

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Add models from other clouds alongside OpenRouter. They appear in the model
        picker as “Provider · model” and route directly to that cloud with your
        credentials. All three clouds are used via their OpenAI-compatible endpoints.
      </p>

      <div className="space-y-2 rounded-xl border border-line p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ProviderRow["kind"])}
            className="rounded-lg border border-line bg-bg px-2 py-2 text-sm outline-none"
          >
            {PROVIDER_KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (e.g. Work Azure)"
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        {(kind === "azure" || kind === "custom" || kind === "google") && (
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={
              kind === "azure"
                ? "https://your-resource.openai.azure.com"
                : kind === "google"
                  ? "Endpoint (blank = Gemini API OpenAI-compat)"
                  : "https://your-host/v1"
            }
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {kind === "bedrock" && (
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Region (us-east-1)"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent sm:w-40"
            />
          )}
          {kind === "azure" && (
            <input
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              placeholder="api-version (blank = 2024-10-21)"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent sm:w-56"
            />
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={kind === "bedrock" ? "Bedrock API key (or use access key below)" : "API key"}
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        {kind === "bedrock" && (
          <div className="space-y-2 rounded-lg border border-dashed border-line p-2.5">
            <p className="text-xs text-ink-muted">
              Or use IAM credentials (access key + secret, signed with SigV4) — most AWS
              accounts. These take precedence over a Bedrock API key.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AWS Access Key ID"
                className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="AWS Secret Access Key"
                className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <input
              type="password"
              value={sessionToken}
              onChange={(e) => setSessionToken(e.target.value)}
              placeholder="Session token (only for temporary credentials)"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        )}
        <textarea
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
          rows={2}
          placeholder={placeholderModels}
          className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={promptPrice}
            onChange={(e) => setPromptPrice(e.target.value)}
            placeholder="$ / 1M input tokens (optional)"
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            value={completionPrice}
            onChange={(e) => setCompletionPrice(e.target.value)}
            placeholder="$ / 1M output tokens (optional)"
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <p className="text-xs text-ink-muted">
          Set prices to get estimated per-reply cost chips for this provider&apos;s
          models (external clouds report tokens, not dollars).
        </p>
        <button
          onClick={create}
          disabled={!name.trim() || !modelsText.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Add provider
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      <div className="divide-y divide-line rounded-xl border border-line">
        {providers.map((p) => (
          <div key={p.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className={`font-medium ${p.enabled ? "" : "line-through opacity-60"}`}>
                {p.name}
              </span>
              <span className="text-xs text-ink-muted">
                {PROVIDER_KINDS.find(([k]) => k === p.kind)?.[1]}
                {p.region ? ` · ${p.region}` : ""}
              </span>
              <span className="ml-auto flex gap-2 text-xs">
                <button onClick={() => test(p.id)} className="rounded border border-line px-2 py-0.5 hover:bg-surface-2">
                  Test
                </button>
                <button
                  onClick={async () => {
                    await api("/api/providers", {
                      method: "PATCH",
                      body: JSON.stringify({ id: p.id, enabled: !p.enabled }),
                    });
                    await load();
                  }}
                  className="rounded border border-line px-2 py-0.5 hover:bg-surface-2"
                >
                  {p.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={async () => {
                    if (!(await confirmDialog(`Remove provider "${p.name}"?`))) return;
                    await api(`/api/providers?id=${p.id}`, { method: "DELETE" });
                    await load();
                  }}
                  className="rounded border border-line px-2 py-0.5 text-red-500 hover:bg-surface-2"
                >
                  Remove
                </button>
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {p.models.length} model{p.models.length === 1 ? "" : "s"}: {p.models.join(", ")}
            </p>
            {status[p.id] && <p className="mt-0.5 text-xs text-ink-muted">{status[p.id]}</p>}
          </div>
        ))}
        {providers.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-ink-muted">
            No extra providers — OpenRouter is built in.
          </p>
        )}
      </div>
    </div>
  );
}

const CONNECTOR_PRESETS = [
  {
    name: "Filesystem",
    description: "Read & write files in a folder you choose (edit the path after adding)",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem C:\\data",
  },
  {
    name: "Fetch",
    description: "Fetch and convert web pages to markdown",
    command: "npx",
    args: "-y @modelcontextprotocol/server-fetch",
  },
  {
    name: "Memory graph",
    description: "A knowledge-graph memory the model can read and write",
    command: "npx",
    args: "-y @modelcontextprotocol/server-memory",
  },
  {
    name: "Sequential thinking",
    description: "Structured step-by-step problem decomposition",
    command: "npx",
    args: "-y @modelcontextprotocol/server-sequential-thinking",
  },
  {
    name: "Everything (demo)",
    description: "MCP test server with echo & sample tools — great for trying tool calls",
    command: "npx",
    args: "-y @modelcontextprotocol/server-everything",
  },
];

// Remote (HTTP) MCP servers — work on serverless too. These are public/no-auth
// and connect instantly (verified against the live endpoints).
const HTTP_CONNECTOR_PRESETS = [
  { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp" },
  { name: "Context7", url: "https://mcp.context7.com/mcp" },
  { name: "GitMCP", url: "https://gitmcp.io/docs" },
  { name: "Microsoft Learn", url: "https://learn.microsoft.com/api/mcp" },
  { name: "Hugging Face", url: "https://huggingface.co/mcp" },
  { name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp" },
];

const SKILL_PRESETS = [
  {
    name: "Weekly status report",
    description: "Use when asked to write a weekly status or progress report",
    instructions:
      "1. Ask for (or gather via available tools) this week's accomplishments, in-progress items, and blockers.\n2. Structure the report as: TL;DR (3 bullets), Done, In progress, Blockers, Next week.\n3. Keep each bullet to one line; bold project names; keep it under a page.\n4. Deliver as a markdown artifact.",
  },
  {
    name: "Meeting notes cleaner",
    description: "Use when given raw meeting notes or a transcript to clean up",
    instructions:
      "1. Extract decisions, action items (with owner + due date if stated), and open questions.\n2. Produce a markdown artifact: Summary (5 lines max), Decisions, Action items (table: what / who / when), Open questions.\n3. Preserve exact figures and names; never invent owners or dates.",
  },
  {
    name: "Code reviewer",
    description: "Use when asked to review code for bugs and improvements",
    instructions:
      "1. Read the code fully before commenting.\n2. Report findings ranked by severity: correctness bugs first, then security, then simplification.\n3. For each finding: quote the exact lines, explain the failure scenario concretely, then show the fixed code.\n4. End with what's GOOD about the code — one or two lines.",
  },
  {
    name: "Pitch deck builder",
    description: "Use when asked to create a pitch or business presentation",
    instructions:
      "1. Ask for: audience, goal, and 3 key points if not given.\n2. Build a slides artifact: title, problem, solution, how-it-works, proof/numbers, ask/next steps, closing.\n3. One idea per slide, max 25 words per slide, strong visual hierarchy in the deck's <style>.",
  },
];

interface ConnectorTool {
  name: string;
  description: string;
}
interface ConnectorRow {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string | null;
  url: string | null;
  headers: string | null;
  enabled: number;
  tools: ConnectorTool[];
  lastTested: number | null;
  hasAuth: boolean;
}

function ConnectorsTab() {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [stdioSupported, setStdioSupported] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({});

  const load = async () => {
    const data = await api<{ stdioSupported: boolean; connectors: ConnectorRow[] }>(
      "/api/connectors"
    );
    setConnectors(data.connectors);
    setStdioSupported(data.stdioSupported);
    if (!data.stdioSupported) setTransport("http");
    return data.connectors;
  };
  useEffect(() => {
    load();
  }, []);

  // Test a connector: discover its functions (cached server-side), then refresh.
  const test = async (id: string) => {
    setTesting((t) => ({ ...t, [id]: true }));
    setAuthUrls((a) => ({ ...a, [id]: "" }));
    try {
      const res = await api<{
        ok: boolean;
        toolCount?: number;
        error?: string;
        needsAuth?: boolean;
        authUrl?: string;
      }>(`/api/connectors/${id}/test`, { method: "POST" });
      if (res.needsAuth && res.authUrl) {
        setAuthUrls((a) => ({ ...a, [id]: res.authUrl! }));
        setStatus((s) => ({
          ...s,
          [id]: { ok: false, msg: "Sign-in required — click Authorize, finish in the new tab, then Test again." },
        }));
      } else {
        setStatus((s) => ({
          ...s,
          [id]: res.ok
            ? { ok: true, msg: `Connected — ${res.toolCount} function${res.toolCount === 1 ? "" : "s"} available.` }
            : { ok: false, msg: res.error || "Connection failed." },
        }));
      }
      await load();
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: { ok: false, msg: String((e as Error).message ?? e) } }));
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  };

  const create = async () => {
    setError(null);
    try {
      const created = await api<{ id: string }>("/api/connectors", {
        method: "POST",
        body: JSON.stringify({ name, transport, command, args, url, bearerToken }),
      });
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setBearerToken("");
      setShowAdd(false);
      await load();
      // Immediately discover its functions and open its detail.
      setOpenId(created.id);
      test(created.id);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const addPreset = async (p: { name: string; command: string; args: string }) => {
    const created = await api<{ id: string }>("/api/connectors", {
      method: "POST",
      body: JSON.stringify({ name: p.name, transport: "stdio", command: p.command, args: p.args }),
    });
    await load();
    setOpenId(created.id);
    test(created.id);
  };

  const toggle = async (c: ConnectorRow) => {
    await api("/api/connectors", {
      method: "PATCH",
      body: JSON.stringify({ id: c.id, enabled: !c.enabled }),
    });
    await load();
  };

  const remove = async (c: ConnectorRow) => {
    if (!(await confirmDialog(`Remove connector "${c.name}"?`))) return;
    await api(`/api/connectors?id=${c.id}`, { method: "DELETE" });
    if (openId === c.id) setOpenId(null);
    await load();
  };

  const target = (c: ConnectorRow) =>
    c.transport === "stdio"
      ? `${c.command ?? ""} ${c.args ? (() => { try { return JSON.parse(c.args!).join(" "); } catch { return c.args; } })() : ""}`.trim()
      : c.url ?? "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Connectors are MCP servers whose functions the model can call mid-conversation
        (the model must support tool use). Add one to see everything it can do; click a
        connector to inspect its functions.
      </p>

      {/* Add connector — collapsed by default to keep the list front-and-center */}
      <div className="rounded-xl border border-line">
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium"
        >
          <Icon name="plus" size={15} /> Add a connector
          <Icon
            name={showAdd ? "chevronDown" : "chevronRight"}
            size={15}
            className="ml-auto text-ink-muted"
          />
        </button>
        {showAdd && (
          <div className="space-y-2 border-t border-line p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. DeepWiki)"
                className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
                className="rounded-lg border border-line bg-bg px-2 py-2 text-sm outline-none"
              >
                <option value="stdio" disabled={!stdioSupported}>
                  Local (stdio){stdioSupported ? "" : " — self-hosted only"}
                </option>
                <option value="http">Remote (HTTP)</option>
              </select>
            </div>
            {transport === "stdio" ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="Command (e.g. npx)"
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent sm:w-40"
                />
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-everything"
                  className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://server.example.com/mcp"
                  className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <input
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  type="password"
                  placeholder="Bearer token (optional)"
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent sm:w-52"
                />
              </div>
            )}
            <button
              onClick={create}
              disabled={!name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Add & discover functions
            </button>
            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="pt-1">
              <p className="mb-1 text-xs font-medium text-ink-muted">Popular remote servers</p>
              <div className="flex flex-wrap gap-1.5">
                {HTTP_CONNECTOR_PRESETS.map((p) => {
                  const added = connectors.some((c) => c.url === p.url);
                  return (
                    <button
                      key={p.url}
                      onClick={async () => {
                        const created = await api<{ id: string }>("/api/connectors", {
                          method: "POST",
                          body: JSON.stringify({ name: p.name, transport: "http", url: p.url }),
                        });
                        await load();
                        setOpenId(created.id);
                        test(created.id);
                      }}
                      disabled={added}
                      className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
                    >
                      {added ? "✓ " : "+ "}
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {stdioSupported && (
                <div className="mt-2">
                  <p className="mb-1 text-xs font-medium text-ink-muted">Popular local servers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CONNECTOR_PRESETS.map((p) => {
                      const added = connectors.some((c) => c.name === p.name);
                      return (
                        <button
                          key={p.name}
                          onClick={() => addPreset(p)}
                          disabled={added}
                          title={p.description}
                          className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
                        >
                          {added ? "✓ " : "+ "}
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Your connectors */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Your connectors ({connectors.length})
        </p>
        <div className="space-y-2">
          {connectors.map((c) => {
            const isOpen = openId === c.id;
            const st = status[c.id];
            return (
              <div key={c.id} className="overflow-hidden rounded-xl border border-line">
                <button
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                >
                  <Icon
                    name={isOpen ? "chevronDown" : "chevronRight"}
                    size={15}
                    className="shrink-0 text-ink-muted"
                  />
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      c.enabled ? "bg-emerald-500" : "bg-ink-muted/40"
                    }`}
                    title={c.enabled ? "Enabled" : "Disabled"}
                  />
                  <span className={`font-medium ${c.enabled ? "" : "opacity-60"}`}>{c.name}</span>
                  <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase text-ink-muted">
                    {c.transport === "stdio" ? "local" : "http"}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-ink-muted">
                    <Icon name="wrench" size={12} />
                    {c.tools.length > 0 ? `${c.tools.length} function${c.tools.length === 1 ? "" : "s"}` : "not tested"}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-line px-3 py-3">
                    {/* Config */}
                    <div className="space-y-1 text-xs text-ink-muted">
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-ink-muted/70">
                          {c.transport === "stdio" ? "Command" : "URL"}
                        </span>
                        <code className="min-w-0 break-all text-ink">{target(c)}</code>
                      </div>
                      {c.transport === "http" && (
                        <div className="flex gap-2">
                          <span className="w-16 shrink-0 text-ink-muted/70">Auth</span>
                          <span className="text-ink">
                            {c.hasAuth ? "OAuth connected" : c.headers ? "Bearer token" : "None"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Status line + Authorize */}
                    {(st || authUrls[c.id]) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {st && (
                          <span className={st.ok ? "text-emerald-500" : "text-red-500"}>{st.msg}</span>
                        )}
                        {authUrls[c.id] && (
                          <a
                            href={authUrls[c.id]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded bg-accent px-2 py-0.5 font-medium text-white hover:bg-accent-hover"
                          >
                            Authorize
                          </a>
                        )}
                      </div>
                    )}

                    {/* Functions */}
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-ink-muted">
                        Functions {c.tools.length > 0 && `(${c.tools.length})`}
                      </p>
                      {c.tools.length > 0 ? (
                        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-bg p-2">
                          {c.tools.map((t) => (
                            <div key={t.name} className="rounded-md px-2 py-1.5 hover:bg-surface-2">
                              <code className="text-xs font-medium text-ink">{t.name}</code>
                              {t.description && (
                                <p className="mt-0.5 line-clamp-3 text-xs text-ink-muted">
                                  {t.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-ink-muted">
                          {testing[c.id]
                            ? "Discovering functions…"
                            : "No functions loaded yet — test the connector to discover them."}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        onClick={() => test(c.id)}
                        disabled={testing[c.id]}
                        className="rounded border border-line px-2.5 py-1 hover:bg-surface-2 disabled:opacity-50"
                      >
                        {testing[c.id] ? "Testing…" : c.tools.length ? "Refresh functions" : "Test & discover"}
                      </button>
                      <button
                        onClick={() => toggle(c)}
                        className="rounded border border-line px-2.5 py-1 hover:bg-surface-2"
                      >
                        {c.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => remove(c)}
                        className="ml-auto rounded border border-line px-2.5 py-1 text-red-500 hover:bg-surface-2"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {connectors.length === 0 && (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
              No connectors yet. Click <span className="font-medium">Add a connector</span> above —
              try a popular remote server to get started instantly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  connector_ids: string | null;
  http_tool_ids: string | null;
  enabled: number;
}

type HttpToolForm = Omit<HttpTool, "user_id" | "created_at"> & { authSecret?: string };

const EMPTY_TOOL: HttpToolForm = {
  id: "",
  name: "",
  description: "",
  method: "GET",
  url_template: "",
  params: [],
  headers: {},
  auth: { type: "none" },
  body_mode: "auto",
  body_template: null,
  response_extract: "",
  max_response_bytes: 24576,
  auto_run: 0,
  source: "manual",
  openapi_group: null,
  enabled: 1,
};

const inputCls =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

/** Settings → Custom tools: define REST endpoints (manually or via OpenAPI) the model can call. */
function HttpToolsTab() {
  const [tools, setTools] = useState<HttpTool[]>([]);
  const [form, setForm] = useState<HttpToolForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [testArgs, setTestArgs] = useState("{}");
  const [importOpen, setImportOpen] = useState(false);
  const [draftIdea, setDraftIdea] = useState("");
  const [drafting, setDrafting] = useState(false);

  const load = () =>
    api<{ tools: HttpTool[] }>("/api/http-tools").then((d) => setTools(d.tools)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof HttpToolForm>(k: K, v: HttpToolForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const isWrite = form && form.method !== "GET" && form.method !== "HEAD";

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const method = form.id ? "PATCH" : "POST";
      const res = await api<{ error?: string }>("/api/http-tools", {
        method,
        body: JSON.stringify(form),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setForm(null);
      setTestOut(null);
      await load();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!form) return;
    setBusy(true);
    setTestOut("Running…");
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(testArgs || "{}");
      } catch {
        setTestOut("Test args must be valid JSON.");
        return;
      }
      const d = await api<{ result?: string; error?: string }>("/api/http-tools/test", {
        method: "POST",
        body: JSON.stringify({ tool: form, id: form.id || undefined, authSecret: form.authSecret, args }),
      });
      setTestOut(d.result ?? d.error ?? "(no output)");
    } catch (e) {
      setTestOut(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const draftFromAI = async () => {
    if (!draftIdea.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const d = await api<Partial<HttpToolForm> & { error?: string }>("/api/http-tools/draft", {
        method: "POST",
        body: JSON.stringify({ prompt: draftIdea }),
      });
      if (d.error) {
        setError(d.error);
        return;
      }
      setForm((f) =>
        f
          ? {
              ...f,
              name: d.name || f.name,
              description: d.description || f.description,
              method: d.method || f.method,
              url_template: d.url_template || f.url_template,
              params: d.params ?? f.params,
              auth: d.auth ?? f.auth,
            }
          : f
      );
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setDrafting(false);
    }
  };

  const toggle = async (t: HttpTool) => {
    await api("/api/http-tools", {
      method: "PATCH",
      body: JSON.stringify({ id: t.id, enabled: !t.enabled }),
    }).catch(() => {});
    load();
  };
  const remove = async (t: HttpTool) => {
    if (!(await confirmDialog(`Delete the "${t.name}" tool?`))) return;
    await api(`/api/http-tools?id=${t.id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const addParam = () =>
    set("params", [...form!.params, { name: "", type: "string", required: false, location: "query" }]);
  const setParam = (i: number, patch: Partial<HttpToolParam>) =>
    set(
      "params",
      form!.params.map((p, j) => (j === i ? { ...p, ...patch } : p))
    );
  const delParam = (i: number) =>
    set("params", form!.params.filter((_, j) => j !== i));

  // ---- Import panel ----
  if (importOpen) {
    return <OpenApiImport onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />;
  }

  // ---- Editor form ----
  if (form) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between pr-10">
          <h3 className="font-display text-lg font-semibold">{form.id ? "Edit tool" : "New custom tool"}</h3>
          <button onClick={() => { setForm(null); setTestOut(null); }} className="text-sm text-ink-muted hover:text-ink">
            ← Back
          </button>
        </div>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="mb-1.5 flex items-center gap-1 text-sm font-medium">
            <Icon name="sparkles" size={14} className="text-accent" /> Describe it — let AI fill in the details
          </p>
          <div className="flex gap-2">
            <input
              value={draftIdea}
              onChange={(e) => setDraftIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  draftFromAI();
                }
              }}
              placeholder="e.g. GitHub API — get a repo's star count by owner and name"
              className={inputCls}
            />
            <button
              onClick={draftFromAI}
              disabled={drafting || !draftIdea.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {drafting ? "…" : "Draft"}
            </button>
          </div>
        </div>

        <Field label="Name" hint="The function name the model calls (letters, numbers, _ or -).">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="get_weather" className={inputCls} />
        </Field>
        <Field label="Description" hint="When should the model use this? Be specific — this drives correct usage.">
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Get the current weather for a city." className={`${inputCls} resize-y`} />
        </Field>
        <div className="flex gap-2">
          <select value={form.method} onChange={(e) => set("method", e.target.value)} className={`${inputCls} w-32`}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input value={form.url_template} onChange={(e) => set("url_template", e.target.value)} placeholder="https://api.example.com/weather/{{city}}" className={inputCls} />
        </div>

        {/* Parameters */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Parameters</span>
            <button onClick={addParam} className="text-xs text-accent hover:underline">+ Add parameter</button>
          </div>
          {form.params.length === 0 && <p className="text-xs text-ink-muted">No parameters. Use {"{{name}}"} in the URL for path values.</p>}
          <div className="space-y-1.5">
            {form.params.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <input value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} placeholder="name" className={`${inputCls} w-28`} />
                <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value as HttpToolParam["type"] })} className={`${inputCls} w-24`}>
                  {["string", "number", "integer", "boolean"].map((t) => <option key={t}>{t}</option>)}
                </select>
                <select value={p.location} onChange={(e) => setParam(i, { location: e.target.value as HttpToolParam["location"] })} className={`${inputCls} w-24`}>
                  {["query", "path", "body", "header"].map((t) => <option key={t}>{t}</option>)}
                </select>
                <input value={p.description ?? ""} onChange={(e) => setParam(i, { description: e.target.value })} placeholder="description" className={`${inputCls} min-w-32 flex-1`} />
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input type="checkbox" checked={!!p.required} onChange={(e) => setParam(i, { required: e.target.checked })} /> req
                </label>
                <button onClick={() => delParam(i)} className="px-1 text-ink-muted hover:text-red-500">✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Auth */}
        <Field label="Authentication">
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={form.auth.type} onChange={(e) => set("auth", { ...form.auth, type: e.target.value as HttpTool["auth"]["type"] })} className={`${inputCls} w-36`}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="apiKey">API key</option>
              <option value="basic">Basic (user:pass)</option>
            </select>
            {form.auth.type === "apiKey" && (
              <>
                <select value={form.auth.in ?? "header"} onChange={(e) => set("auth", { ...form.auth, in: e.target.value as "header" | "query" })} className={`${inputCls} w-24`}>
                  <option value="header">header</option>
                  <option value="query">query</option>
                </select>
                <input value={form.auth.name ?? ""} onChange={(e) => set("auth", { ...form.auth, name: e.target.value })} placeholder="X-Api-Key" className={`${inputCls} w-40`} />
              </>
            )}
            {form.auth.type !== "none" && (
              <input type="password" onChange={(e) => set("authSecret", e.target.value)} placeholder={form.auth.hasSecret ? "•••• (leave blank to keep)" : "secret value"} className={`${inputCls} min-w-40 flex-1`} />
            )}
          </div>
        </Field>

        <Field label="Response path (optional)" hint="Dot-path to keep only the useful part, e.g. data.items — avoids dumping huge JSON.">
          <input value={form.response_extract ?? ""} onChange={(e) => set("response_extract", e.target.value)} placeholder="data.results" className={inputCls} />
        </Field>

        {isWrite && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            <input type="checkbox" checked={!!form.auto_run} onChange={(e) => set("auto_run", e.target.checked ? 1 : 0)} className="mt-0.5" />
            <span>
              <b>Let the model run this automatically.</b> This is a <code>{form.method}</code> request that can change data — off by default so it can’t be triggered without your say-so.
            </span>
          </label>
        )}

        {/* Test */}
        <div className="rounded-lg border border-line bg-bg p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Test</span>
            <button onClick={test} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50">Run test</button>
          </div>
          <input value={testArgs} onChange={(e) => setTestArgs(e.target.value)} placeholder='{"city":"Paris"}' className={`${inputCls} font-mono text-xs`} />
          {testOut != null && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">{testOut}</pre>}
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            {busy ? "…" : form.id ? "Save changes" : "Create tool"}
          </button>
          <button onClick={() => { setForm(null); setTestOut(null); }} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">Cancel</button>
        </div>
      </div>
    );
  }

  // ---- List ----
  return (
    <div className="space-y-4">
      {/* pr-10 keeps the buttons clear of the dialog's ✕ close control. */}
      <div className="flex items-center justify-between gap-2 pr-10">
        <p className="min-w-0 text-sm text-ink-muted">Give the model your own REST endpoints as callable tools — no MCP server needed.</p>
        <div className="flex shrink-0 gap-1.5">
          <button onClick={() => setImportOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">Import OpenAPI</button>
          <button onClick={() => { setForm({ ...EMPTY_TOOL }); setTestOut(null); }} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">+ New tool</button>
        </div>
      </div>
      {tools.length === 0 && <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">No custom tools yet.</p>}
      <div className="space-y-2">
        {tools.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold">{t.method}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {t.source === "openapi" && <span className="shrink-0 text-[10px] text-ink-muted">OpenAPI</span>}
              </div>
              <div className="truncate text-xs text-ink-muted">{t.description || t.url_template}</div>
            </div>
            <button onClick={() => toggle(t)} title={t.enabled ? "Enabled" : "Disabled"} className={`shrink-0 text-xs ${t.enabled ? "text-emerald-600" : "text-ink-muted"}`}>
              {t.enabled ? "On" : "Off"}
            </button>
            <button onClick={() => { setForm({ ...t, authSecret: undefined }); setTestOut(null); }} className="shrink-0 text-xs text-ink-muted hover:text-ink">Edit</button>
            <button onClick={() => remove(t)} className="shrink-0 text-xs text-ink-muted hover:text-red-500">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** OpenAPI import: paste a spec URL/JSON → pick operations → create tools. */
function OpenApiImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [specUrl, setSpecUrl] = useState("");
  const [specText, setSpecText] = useState("");
  const [parsed, setParsed] = useState<{
    title: string;
    baseUrl: string;
    auth: HttpTool["auth"];
    operations: { name: string; description: string; method: string; urlTemplate: string; params: HttpToolParam[] }[];
  } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupSlug = (parsed?.title || "api").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "api";

  const parse = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<typeof parsed & { error?: string }>("/api/http-tools/import", {
        method: "POST",
        body: JSON.stringify({ specUrl: specUrl.trim() || undefined, spec: specText.trim() || undefined }),
      });
      if ((d as { error?: string })?.error) { setError((d as { error?: string }).error!); return; }
      setParsed(d);
      setSel(new Set(d!.operations.map((_, i) => i).slice(0, 0))); // default none selected
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!parsed || sel.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const group = `${groupSlug}_${Date.now().toString(36)}`;
      const tools = [...sel].map((i) => {
        const op = parsed.operations[i];
        return {
          name: `${groupSlug}_${op.name}`.slice(0, 48),
          description: op.description,
          method: op.method,
          url_template: op.urlTemplate,
          params: op.params,
          headers: {},
          auth: parsed.auth,
          authSecret: parsed.auth.type !== "none" ? secret : undefined,
          body_mode: "auto",
          response_extract: "",
          max_response_bytes: 24576,
          auto_run: 0,
          source: "openapi",
          openapi_group: group,
          enabled: 1,
        };
      });
      const res = await api<{ error?: string }>("/api/http-tools", { method: "POST", body: JSON.stringify({ tools }) });
      if (res?.error) { setError(res.error); return; }
      onDone();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pr-10">
        <h3 className="font-display text-lg font-semibold">Import from OpenAPI</h3>
        <button onClick={onClose} className="text-sm text-ink-muted hover:text-ink">← Back</button>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {!parsed ? (
        <>
          <Field label="Spec URL" hint="A link to an OpenAPI 3.x JSON spec.">
            <input value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://api.example.com/openapi.json" className={inputCls} />
          </Field>
          <p className="text-center text-xs text-ink-muted">— or paste the JSON —</p>
          <textarea value={specText} onChange={(e) => setSpecText(e.target.value)} rows={5} placeholder='{ "openapi": "3.0.0", ... }' className={`${inputCls} resize-y font-mono text-xs`} />
          <button onClick={parse} disabled={busy || (!specUrl.trim() && !specText.trim())} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            {busy ? "Parsing…" : "Parse spec"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            <b>{parsed.title}</b> — {parsed.operations.length} operations.{" "}
            <span className="text-ink-muted">Pick the few you need (too many tools hurts model accuracy).</span>
          </p>
          {parsed.auth.type !== "none" && (
            <Field label={`Auth: ${parsed.auth.type}${parsed.auth.name ? ` (${parsed.auth.name})` : ""}`}>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="secret value (applied to all imported tools)" className={inputCls} />
            </Field>
          )}
          <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-line p-2">
            {parsed.operations.map((op, i) => (
              <label key={i} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={sel.has(i)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(i) : n.delete(i); return n; })} />
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold">{op.method}</span>
                <span className="truncate">{op.name} — <span className="text-ink-muted">{op.description}</span></span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={busy || sel.size === 0} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
              {busy ? "…" : `Import ${sel.size} tool${sel.size === 1 ? "" : "s"}`}
            </button>
            <button onClick={() => setParsed(null)} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">Back</button>
          </div>
        </>
      )}
    </div>
  );
}

function PromptsTab() {
  const [prompts, setPrompts] = useState<
    { id: string; name: string; slug: string; body: string }[]
  >([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const load = async () =>
    setPrompts(await api<{ id: string; name: string; slug: string; body: string }[]>("/api/prompts"));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim() || !body.trim()) return;
    await api("/api/prompts", { method: "POST", body: JSON.stringify({ name, body }) });
    setName("");
    setBody("");
    await load();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Reusable prompts. Type <code className="rounded bg-surface-2 px-1">/</code> in the
        composer to insert one by its slash name.
      </p>
      <div className="space-y-2 rounded-xl border border-line p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Blog outline)"
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Prompt text…"
          className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={create}
          disabled={!name.trim() || !body.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Save prompt
        </button>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {prompts.map((p) => (
          <div key={p.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">/{p.slug}</span>
              <span className="text-xs text-ink-muted">{p.name}</span>
              <button
                onClick={async () => {
                  await api(`/api/prompts?id=${p.id}`, { method: "DELETE" });
                  await load();
                }}
                className="ml-auto text-xs text-ink-muted hover:text-red-500"
              >
                Delete
              </button>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{p.body}</p>
          </div>
        ))}
        {prompts.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-ink-muted">No saved prompts yet.</p>
        )}
      </div>
    </div>
  );
}

interface SkillConnLite {
  id: string;
  name: string;
  tools: { name: string; description: string }[];
}

interface DesignSystemRow {
  id: string;
  user_id: string;
  name: string;
  spec: string;
  palette: string | null;
  is_default: number;
  shared?: boolean;
  owner_name?: string;
  sharedWith: { user_id: string; email: string; name: string }[];
}

function dsSwatches(palette: string | null): string[] {
  try {
    const arr = palette ? JSON.parse(palette) : [];
    return Array.isArray(arr) ? arr.slice(0, 6) : [];
  } catch {
    return [];
  }
}

/**
 * Design systems: create (describe → AI drafts the spec), edit/remix, set a
 * default, share with other Liberde users by email. Applied from the Design
 * workspace's picker chip.
 */
function DesignSystemsTab({ models }: { models: ModelInfo[] }) {
  const [systems, setSystems] = useState<DesignSystemRow[]>([]);
  const [editing, setEditing] = useState<DesignSystemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [palette, setPalette] = useState<string | null>(null);
  const [describe, setDescribe] = useState("");
  const [draftImages, setDraftImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [draftModel, setDraftModel] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareEmails, setShareEmails] = useState<Record<string, string>>({});
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);

  const load = () =>
    api<DesignSystemRow[]>("/api/design-systems").then(setSystems).catch(() => {});
  // Reload AND notify other views (e.g. the design-mode picker chip) so a
  // system created/edited/deleted here shows up without a page refresh.
  const reload = async () => {
    await load();
    window.dispatchEvent(new CustomEvent("liberde:design-systems-changed"));
  };
  useEffect(() => {
    load();
  }, []);

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setName("");
    setSpec("");
    setPalette(null);
    setDescribe("");
    setError(null);
  };
  const startEdit = (s: DesignSystemRow) => {
    setEditing(s);
    setCreating(false);
    setName(s.name);
    setSpec(s.spec);
    setPalette(s.palette);
    setDescribe("");
    setError(null);
  };
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const next = [...draftImages];
    for (const f of Array.from(files).slice(0, 4 - next.length)) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const att = await fileToUploadAttachment(f);
        if (att.dataUrl) next.push({ name: f.name, dataUrl: att.dataUrl });
      } catch {
        /* skip unreadable file */
      }
    }
    setDraftImages(next.slice(0, 4));
  };

  // Describe and/or screenshots → AI drafts (create); instruction + current
  // spec → AI remixes. Optional model override for vision extraction.
  const draft = async () => {
    if (!describe.trim() && draftImages.length === 0) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await api<{ name: string; spec: string; palette: string }>(
        "/api/design-systems/draft",
        {
          method: "POST",
          body: JSON.stringify({
            prompt: describe,
            ...(spec.trim() ? { current: spec, name } : {}),
            ...(draftImages.length
              ? { images: draftImages.map((d) => d.dataUrl) }
              : {}),
            ...(draftModel ? { model: draftModel } : {}),
          }),
        }
      );
      if (res.name && !name.trim()) setName(res.name);
      else if (res.name && !spec.trim()) setName(res.name);
      setSpec(res.spec);
      setPalette(res.palette);
      setDescribe("");
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    if (!name.trim() || !spec.trim()) {
      setError("Name and spec are both required — use Draft with AI or write the spec.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api("/api/design-systems", {
          method: "PATCH",
          body: JSON.stringify({ id: editing.id, name, spec, palette }),
        });
      } else {
        await api("/api/design-systems", {
          method: "POST",
          body: JSON.stringify({ name, spec, palette, isDefault: systems.length === 0 }),
        });
      }
      closeForm();
      await reload();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (s: DesignSystemRow, on: boolean) => {
    await api("/api/design-systems", {
      method: "PATCH",
      body: JSON.stringify({ id: s.id, isDefault: on }),
    }).catch(() => {});
    reload();
  };

  const remove = async (s: DesignSystemRow) => {
    if (!(await confirmDialog(`Delete design system "${s.name}"?`))) return;
    await api(`/api/design-systems?id=${s.id}`, { method: "DELETE" }).catch(() => {});
    if (editing?.id === s.id) closeForm();
    reload();
  };

  const share = async (s: DesignSystemRow) => {
    const email = (shareEmails[s.id] ?? "").trim();
    if (!email) return;
    setShareBusyId(s.id);
    setError(null);
    try {
      await api("/api/design-systems/share", {
        method: "POST",
        body: JSON.stringify({ id: s.id, email }),
      });
      setShareEmails((m) => ({ ...m, [s.id]: "" }));
      await load();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setShareBusyId(null);
    }
  };

  const unshare = async (s: DesignSystemRow, userId: string) => {
    await api("/api/design-systems/share", {
      method: "DELETE",
      body: JSON.stringify({ id: s.id, userId }),
    }).catch(() => {});
    load();
  };

  const formOpen = creating || editing;

  return (
    <div className="space-y-4">
      {/* pr-10 keeps the button clear of the dialog's ✕ close control. */}
      <div className="flex items-center justify-between gap-2 pr-10">
        <p className="text-sm text-ink-muted">
          Reusable brand specs — colors, fonts, spacing, components. Pick one in the
          Design workspace and every design follows it.
        </p>
        {!formOpen && (
          <button
            onClick={startCreate}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            + New
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {formOpen && (
        <div className="space-y-2.5 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {editing ? `Edit ${editing.name}` : "New design system"}
            </p>
            <button onClick={closeForm} className="text-xs text-ink-muted hover:text-ink">
              Cancel
            </button>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. MyBrand, Acme Deck)"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <input
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft()}
              placeholder={
                spec.trim()
                  ? "Remix: e.g. make the primary a deeper blue, swap to a serif"
                  : "Describe the brand: e.g. warm minimal SaaS, terracotta + cream, friendly"
              }
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={draft}
              disabled={(!describe.trim() && draftImages.length === 0) || drafting}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              <Icon
                name={drafting ? "refresh" : "sparkles"}
                size={13}
                className={drafting ? "animate-spin" : ""}
              />
              {drafting ? "Drafting…" : spec.trim() ? "Remix with AI" : "Draft with AI"}
            </button>
          </div>
          {/* Extract from screenshots/brand assets — like Claude Design's import. */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-ink">
              <Icon name="image" size={13} />
              {draftImages.length ? "Add more" : "Attach screenshots / brand assets"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {draftImages.map((img, i) => (
              <span key={i} className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  title={img.name}
                  className="h-10 w-10 rounded-lg border border-line object-cover"
                />
                <button
                  onClick={() =>
                    setDraftImages((arr) => arr.filter((_, j) => j !== i))
                  }
                  className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-surface-2 text-[9px] text-ink-muted shadow hover:text-ink"
                  aria-label={`Remove ${img.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              Draft model
              <select
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                title={
                  draftImages.length
                    ? "Screenshots need a model that understands images"
                    : "Which model writes the spec. Auto = your planner model, falling back to title, then default."
                }
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="">Auto (planner → title → default)</option>
                {models
                  // Screenshots require vision; text-only drafting can use anything.
                  .filter((m) => (draftImages.length ? m.supportsImages : true))
                  .slice(0, 60)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {draftImages.length > 0 && draftModel && !models.find((m) => m.id === draftModel)?.supportsImages && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              That model can&apos;t read images — pick a vision model for screenshot
              extraction.
            </p>
          )}
          {dsSwatches(palette).length > 0 && (
            <div className="flex items-center gap-1.5">
              {dsSwatches(palette).map((c, i) => (
                <span
                  key={i}
                  title={c}
                  className="h-5 w-5 rounded-full border border-black/10 dark:border-white/20"
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
          <textarea
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            rows={10}
            placeholder="The spec (markdown): palette, typography, spacing, components, voice. Draft with AI fills this in."
            className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent"
          />
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create design system"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {systems.map((s) => (
          <div key={s.id} className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex shrink-0">
                  {dsSwatches(s.palette).map((c, i) => (
                    <span
                      key={i}
                      className="h-3.5 w-3.5 rounded-full border border-black/10 dark:border-white/20"
                      style={{ background: c, marginLeft: i === 0 ? 0 : -5 }}
                    />
                  ))}
                </span>
                <span className="truncate text-sm font-medium">{s.name}</span>
                {s.shared ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                    shared by {s.owner_name ?? "a teammate"}
                  </span>
                ) : s.is_default ? (
                  <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    default
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {!s.shared && (
                  <>
                    <button
                      onClick={() => setDefault(s, !s.is_default)}
                      title={s.is_default ? "Unset default" : "Use for every new design"}
                      className="text-ink-muted hover:text-ink"
                    >
                      {s.is_default ? "★" : "☆"}
                    </button>
                    <button
                      onClick={() => startEdit(s)}
                      className="text-ink-muted hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="text-ink-muted hover:text-red-500"
                    >
                      Delete
                    </button>
                  </>
                )}
              </span>
            </div>
            {!s.shared && (
              <div className="mt-2 border-t border-line pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-ink-muted">Shared with:</span>
                  {s.sharedWith.length === 0 && (
                    <span className="text-[11px] text-ink-muted">nobody yet</span>
                  )}
                  {s.sharedWith.map((m) => (
                    <span
                      key={m.user_id}
                      className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px]"
                    >
                      {m.name || m.email}
                      <button
                        onClick={() => unshare(s, m.user_id)}
                        className="text-ink-muted hover:text-ink"
                        aria-label={`Stop sharing with ${m.email}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <input
                    value={shareEmails[s.id] ?? ""}
                    onChange={(e) =>
                      setShareEmails((m) => ({ ...m, [s.id]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && share(s)}
                    placeholder="teammate@email.com"
                    className="w-44 rounded-lg border border-line bg-bg px-2 py-1 text-[11px] outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => share(s)}
                    disabled={!(shareEmails[s.id] ?? "").trim() || shareBusyId === s.id}
                    className="rounded-lg border border-line px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-40"
                  >
                    Share
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {systems.length === 0 && !formOpen && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            No design systems yet. Create one and every design you build will stay on
            brand.
          </p>
        )}
      </div>
    </div>
  );
}

function SkillsTab({ models }: { models: ModelInfo[] }) {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [conns, setConns] = useState<SkillConnLite[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [httpTools, setHttpTools] = useState<{ id: string; name: string; description: string }[]>([]);
  const [httpToolIds, setHttpToolIds] = useState<string[]>([]);
  const [idea, setIdea] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setSkills(await api<SkillRow[]>("/api/skills"));
    try {
      const d = await api<{ connectors: SkillConnLite[] }>("/api/connectors");
      setConns(d.connectors.map((c) => ({ id: c.id, name: c.name, tools: c.tools ?? [] })));
    } catch {
      /* connectors optional */
    }
    try {
      const h = await api<{ tools: HttpTool[] }>("/api/http-tools");
      setHttpTools((h.tools ?? []).map((t) => ({ id: t.id, name: t.name, description: t.description })));
    } catch {
      /* http tools optional */
    }
  };
  useEffect(() => {
    load();
  }, []);

  const reset = () => {
    setEditId(null);
    setName("");
    setDescription("");
    setInstructions("");
    setConnectorIds([]);
    setHttpToolIds([]);
    setIdea("");
    setError(null);
  };

  const draft = async () => {
    if (!idea.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const d = await api<{
        name: string;
        description: string;
        instructions: string;
        connectorIds: string[];
      }>("/api/skills/draft", {
        method: "POST",
        body: JSON.stringify({ prompt: idea, ...(draftModel ? { model: draftModel } : {}) }),
      });
      setName(d.name);
      setDescription(d.description);
      setInstructions(d.instructions);
      setConnectorIds(d.connectorIds ?? []);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editId) {
        await api("/api/skills", {
          method: "PATCH",
          body: JSON.stringify({ id: editId, name, description, instructions, connectorIds, httpToolIds }),
        });
      } else {
        await api("/api/skills", {
          method: "POST",
          body: JSON.stringify({ name, description, instructions, connectorIds, httpToolIds }),
        });
      }
      reset();
      await load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const edit = (s: SkillRow) => {
    setEditId(s.id);
    setName(s.name);
    setDescription(s.description);
    setInstructions(s.instructions);
    let ids: string[] = [];
    try {
      ids = s.connector_ids ? JSON.parse(s.connector_ids) : [];
    } catch {
      ids = [];
    }
    setConnectorIds(ids);
    let hids: string[] = [];
    try {
      hids = s.http_tool_ids ? JSON.parse(s.http_tool_ids) : [];
    } catch {
      hids = [];
    }
    setHttpToolIds(hids);
    setIdea("");
  };

  const toggleConnector = (id: string) =>
    setConnectorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleHttpTool = (id: string) =>
    setHttpToolIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggle = async (s: SkillRow) => {
    await api("/api/skills", { method: "PATCH", body: JSON.stringify({ id: s.id, enabled: !s.enabled }) });
    await load();
  };

  const remove = async (s: SkillRow) => {
    if (!(await confirmDialog(`Delete skill "${s.name}"?`))) return;
    if (editId === s.id) reset();
    await api(`/api/skills?id=${s.id}`, { method: "DELETE" });
    await load();
  };

  const connName = (id: string) => conns.find((c) => c.id === id)?.name ?? "connector";

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Skills teach the assistant how to do a specific job. It sees each skill&apos;s
        name and description in every chat and loads the full instructions only when the
        task matches. Attach connectors so the skill knows which MCP tools to use.
      </p>

      {/* Builder */}
      <div className="space-y-3 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {editId ? "Edit skill" : "Train a new skill"}
          </span>
          {editId && (
            <button onClick={reset} className="text-xs text-ink-muted hover:text-ink">
              Cancel edit
            </button>
          )}
        </div>

        {/* AI-assisted drafting */}
        <div className="rounded-lg border border-dashed border-line bg-bg p-2.5">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Icon name="sparkles" size={13} /> Describe it, let AI draft it
          </label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            placeholder="e.g. Research a company using DeepWiki and Microsoft Learn, then write a one-page brief"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              onClick={draft}
              disabled={!idea.trim() || drafting}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40"
            >
              <Icon name={drafting ? "refresh" : "sparkles"} size={14} className={drafting ? "animate-spin" : ""} />
              {drafting ? "Drafting…" : "Draft skill"}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              Draft model
              <select
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                title="Which model writes the skill. Auto = your planner model, falling back to title, then default."
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="">Auto (planner → title → default)</option>
                {models.slice(0, 60).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Editable fields */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name (e.g. Company research brief)"
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="When to use it (shown to the model in every chat)"
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          placeholder="Step-by-step instructions the assistant follows once the skill loads…"
          className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />

        {/* Connector attachment */}
        <div>
          <p className="mb-1 text-xs font-medium text-ink-muted">
            Tools this skill uses {connectorIds.length > 0 && `(${connectorIds.length})`}
          </p>
          {conns.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No connectors yet — add MCP servers in the Connectors tab to bundle their tools.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {conns.map((c) => {
                const on = connectorIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleConnector(c.id)}
                    title={c.tools.map((t) => t.name).join(", ")}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      on
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line text-ink-muted hover:bg-surface-2"
                    }`}
                  >
                    {on ? "✓ " : "+ "}
                    {c.name}
                    {c.tools.length > 0 && <span className="opacity-60"> · {c.tools.length}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom HTTP tool attachment */}
        <div>
          <p className="mb-1 text-xs font-medium text-ink-muted">
            Custom tools this skill uses {httpToolIds.length > 0 && `(${httpToolIds.length})`}
          </p>
          {httpTools.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No custom tools yet — add REST endpoints in the Custom tools tab to bundle them.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {httpTools.map((t) => {
                const on = httpToolIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleHttpTool(t.id)}
                    title={t.description}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      on
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line text-ink-muted hover:bg-surface-2"
                    }`}
                  >
                    {on ? "✓ " : "+ "}
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!name.trim() || !description.trim() || !instructions.trim() || saving}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {saving ? "Saving…" : editId ? "Update skill" : "Save skill"}
          </button>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>

      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Skill templates — one-click add
        </summary>
        <div className="divide-y divide-line border-t border-line">
          {SKILL_PRESETS.map((p) => (
            <div key={p.name} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{p.name}</span>
                <p className="text-xs text-ink-muted">{p.description}</p>
              </div>
              <button
                onClick={async () => {
                  await api("/api/skills", { method: "POST", body: JSON.stringify(p) }).catch(() => {});
                  await load();
                }}
                disabled={skills.some((s) => s.name === p.name)}
                className="shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2 disabled:opacity-40"
              >
                {skills.some((s) => s.name === p.name) ? "Added" : "+ Add"}
              </button>
            </div>
          ))}
        </div>
      </details>

      {/* Existing skills */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Your skills ({skills.length})
        </p>
        <div className="space-y-2">
          {skills.map((s) => {
            let ids: string[] = [];
            try {
              ids = s.connector_ids ? JSON.parse(s.connector_ids) : [];
            } catch {
              ids = [];
            }
            return (
              <div key={s.id} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    className={`text-left font-medium ${s.enabled ? "" : "line-through opacity-60"}`}
                  >
                    {s.name}
                  </button>
                  <span className="ml-auto flex gap-2 text-xs">
                    <button onClick={() => edit(s)} className="rounded border border-line px-2 py-0.5 hover:bg-surface-2">
                      Edit
                    </button>
                    <button onClick={() => toggle(s)} className="rounded border border-line px-2 py-0.5 hover:bg-surface-2">
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => remove(s)} className="rounded border border-line px-2 py-0.5 text-red-500 hover:bg-surface-2">
                      Delete
                    </button>
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{s.description}</p>
                {ids.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ids.map((id) => (
                      <span key={id} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                        <Icon name="wrench" size={10} />
                        {connName(id)}
                      </span>
                    ))}
                  </div>
                )}
                {expanded === s.id && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
                    {s.instructions}
                  </pre>
                )}
              </div>
            );
          })}
          {skills.length === 0 && (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
              No skills yet. Describe one above and click <span className="font-medium">Draft skill</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function ModelSelect({
  models,
  value,
  onChange,
  allowAuto = false,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (v: string) => void;
  /** Offer the "auto" smart-routing sentinel (only valid for the default model). */
  allowAuto?: boolean;
}) {
  const listId = allowAuto ? "liberde-models-auto" : "liberde-models";
  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        placeholder={allowAuto ? "auto — or a provider/model-id" : "provider/model-id"}
      />
      <datalist id={listId}>
        {allowAuto && <option value="auto">✨ Auto — best model per message</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
    </>
  );
}

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Per-device push notification opt-in (agent runs + scheduled tasks). */
function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true);
    fetch("/api/push")
      .then((r) => r.json())
      .then(async (info) => {
        setServerEnabled(Boolean(info.enabled));
        setPublicKey(info.publicKey ?? null);
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && info.publicKey && !subMatchesKey(sub, info.publicKey)) {
          // Bound to a previous server key (keys were rotated) — sends can
          // never reach this subscription. Re-subscribe under the new key.
          try {
            await sub.unsubscribe();
            if (Notification.permission === "granted") {
              const fresh = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(info.publicKey) as BufferSource,
              });
              await fetch("/api/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fresh.toJSON()),
              });
              setOn(true);
              setNote("Notifications were re-registered on this device (server keys had changed).");
              return;
            }
          } catch {
            /* fall through to off */
          }
          setOn(false);
          setNote("Notifications needed re-enabling after a server update — flip the toggle back on.");
          return;
        }
        if (sub) {
          // Make sure the server still has this device on file (idempotent).
          fetch("/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          }).catch(() => {});
        }
        setOn(Boolean(sub));
      })
      .catch(() => {});
  }, []);

  const toggle = async (want: boolean) => {
    if (busy || !publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (want) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setNote("Notifications are blocked for this site in your browser settings.");
          return;
        }
        // subscribe() throws InvalidStateError if a subscription under a
        // different (old) key still exists — clear it first.
        const existing = await reg.pushManager.getSubscription();
        if (existing && !subMatchesKey(existing, publicKey)) {
          await existing.unsubscribe().catch(() => {});
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(publicKey) as BufferSource,
        });
        await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setOn(true);
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
            method: "DELETE",
          });
          await sub.unsubscribe();
        }
        setOn(false);
      }
    } catch (e) {
      setNote(`Could not update notifications: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={on}
          disabled={busy || !serverEnabled}
          onChange={(e) => toggle(e.target.checked)}
          className="accent-(--color-accent)"
        />
        Push notifications
      </label>
      <p className="mt-1 text-xs text-ink-muted">
        {serverEnabled
          ? "Get notified on this device when a Plan or scheduled task finishes."
          : "Not configured on this server (VAPID keys missing)."}
      </p>
      {on && serverEnabled && (
        <button
          onClick={async () => {
            setNote(null);
            try {
              await fetch("/api/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "test" }),
              });
              setNote("Test sent — you should see a notification within a few seconds.");
            } catch {
              setNote("Couldn't send the test — try again.");
            }
          }}
          className="mt-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          Send test notification
        </button>
      )}
      {note && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}

/** True when an existing browser subscription was created with `key`. */
function subMatchesKey(sub: PushSubscription, key: string): boolean {
  try {
    const current = sub.options?.applicationServerKey;
    if (!current) return true; // can't tell — assume fine rather than churn
    const a = new Uint8Array(current);
    const b = urlB64ToUint8Array(key);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  } catch {
    return true;
  }
}
