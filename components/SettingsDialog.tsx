"use client";

import { confirmDialog } from "@/lib/ui";
import { useEffect, useState } from "react";
import type { AppSettings, ModelInfo } from "@/lib/types";
import { api } from "@/lib/client";
import Icon from "./Icon";

interface PlatformKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  key?: string;
}

export default function SettingsDialog({
  settings,
  models,
  onClose,
  onSaved,
}: {
  settings: AppSettings;
  models: ModelInfo[];
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
}) {
  const [tab, setTab] = useState<
    "general" | "personalization" | "providers" | "connectors" | "skills" | "prompts" | "keys" | "admin"
  >("general");
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
  const [memories, setMemories] = useState<
    { id: string; content: string; created_at: number }[]
  >([]);
  const [editingMemId, setEditingMemId] = useState<string | null>(null);
  const [editingMemText, setEditingMemText] = useState("");
  const [newMemText, setNewMemText] = useState("");
  const [temperature, setTemperature] = useState(settings.temperature);
  const [monthlyBudget, setMonthlyBudget] = useState(String(settings.monthlyBudget ?? 0));
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
          temperature,
          monthlyBudget: Number(monthlyBudget) || 0,
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
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">✕</button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-line px-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["general", "General"],
              ["personalization", "Personal"],
              ["providers", "Providers"],
              ["connectors", "Connectors"],
              ["skills", "Skills"],
              ["prompts", "Prompts"],
              ["keys", "Keys"],
              ["admin", "Admin"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap rounded-t-lg px-2.5 py-1.5 text-sm ${
                tab === t
                  ? "border border-b-0 border-line bg-surface font-medium"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
                <ModelSelect models={models} value={defaultModel} onChange={setDefaultModel} />
              </Field>

              <Field
                label="Title model"
                hint="Small, cheap model used to auto-name conversations."
              >
                <ModelSelect models={models} value={titleModel} onChange={setTitleModel} />
              </Field>

              <Field
                label="Planner model (optional)"
                hint="Cheap model that plans 🤖 Agent and 🔬 Research runs. Blank = use the chat's model."
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

              <Field
                label="Monthly budget (USD)"
                hint="Blocks new generations once this month's spend is reached. 0 = unlimited. See spend on the Usage page."
              >
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={monthlyBudget}
                  onChange={(e) => setMonthlyBudget(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>
            </div>
          ) : tab === "personalization" ? (
            <div className="space-y-5">
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
          ) : tab === "skills" ? (
            <SkillsTab />
          ) : tab === "prompts" ? (
            <PromptsTab />
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
  );
}

function AdminTab() {
  const [data, setData] = useState<{
    users: { id: string; email: string; name: string; is_admin: number; created_at: number }[];
    allowSignups: boolean;
    me: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            </div>
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
  kind: "azure" | "bedrock" | "google" | "custom";
  name: string;
  enabled: number;
  endpoint: string | null;
  region: string | null;
  models: string[];
  hasApiKey: boolean;
}

const PROVIDER_KINDS = [
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
  enabled: number;
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

function SkillsTab() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [conns, setConns] = useState<SkillConnLite[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [idea, setIdea] = useState("");
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
      }>("/api/skills/draft", { method: "POST", body: JSON.stringify({ prompt: idea }) });
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
          body: JSON.stringify({ id: editId, name, description, instructions, connectorIds }),
        });
      } else {
        await api("/api/skills", {
          method: "POST",
          body: JSON.stringify({ name, description, instructions, connectorIds }),
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
    setIdea("");
  };

  const toggleConnector = (id: string) =>
    setConnectorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
          <button
            onClick={draft}
            disabled={!idea.trim() || drafting}
            className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40"
          >
            <Icon name={drafting ? "refresh" : "sparkles"} size={14} className={drafting ? "animate-spin" : ""} />
            {drafting ? "Drafting…" : "Draft skill"}
          </button>
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
}: {
  models: ModelInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <input
        list="liberde-models"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        placeholder="provider/model-id"
      />
      <datalist id="liberde-models">
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
          ? "Get notified on this device when an agent run or scheduled task finishes."
          : "Not configured on this server (VAPID keys missing)."}
      </p>
      {note && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}
