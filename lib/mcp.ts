import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getConnectorOAuth,
  getSetting,
  getSkill,
  listConnectors,
  listHttpTools,
  listSkills,
  saveGeneratedImage,
  type Connector,
} from "./db";
import { AuthorizationRequiredError, makeOAuthProvider } from "./mcp-oauth";
import { audit } from "./audit";
import type { DiscoveredTool, ToolAnnotations } from "./types";

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type { DiscoveredTool, ToolAnnotations };

interface LiveTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: ToolAnnotations;
}

interface LiveConnection {
  client: Client;
  /** original tool name by namespaced name */
  tools: Map<string, LiveTool>;
}

const liveKey = "__liberdeMcp";
function liveMap(): Map<string, LiveConnection> {
  const g = globalThis as unknown as { [liveKey]?: Map<string, LiveConnection> };
  if (!g[liveKey]) g[liveKey] = new Map();
  return g[liveKey]!;
}

const sanitize = (s: string, max: number) =>
  s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, max) || "server";

/**
 * OpenAI-dialect function names are capped at 64 characters, and every provider
 * behind OpenRouter enforces it. The namespaced name must therefore fit in 64
 * no matter how long the connector and tool names are.
 */
const TOOL_NAME_MAX = 64;
const PREFIX_NAME_MAX = 24;
const ID_FRAGMENT = 6;
const HASH_LEN = 8;

/** FNV-1a, hex. Not a security hash — just a short, stable disambiguator. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(HASH_LEN, "0").slice(0, HASH_LEN);
}

/** Unique per-connector prefix: readable name + id fragment so two connectors never collide. */
const connectorPrefix = (c: Connector) =>
  `${sanitize(c.name, PREFIX_NAME_MAX)}_${c.id.replaceAll("-", "").slice(0, ID_FRAGMENT)}`;

/**
 * The callable name for one tool on one connector, guaranteed to fit in 64
 * characters. When the tool half has to be truncated, a hash of the ORIGINAL
 * name is appended — otherwise two long tool names sharing a leading substring
 * (`create_incident_from_alert` / `create_incident_from_email`) would collapse
 * onto the same callable name and the second would be unreachable.
 *
 * Both the advertised list and the dispatch lookup go through here, so the two
 * can never drift apart.
 */
export function namespacedToolName(connector: Connector, toolName: string): string {
  const prefix = connectorPrefix(connector);
  const tool = sanitize(toolName, TOOL_NAME_MAX);
  const full = `${prefix}__${tool}`;
  if (full.length <= TOOL_NAME_MAX) return full;
  const room = TOOL_NAME_MAX - prefix.length - 2 - 1 - HASH_LEN;
  return `${prefix}__${tool.slice(0, Math.max(1, room))}_${shortHash(toolName)}`;
}

/** Tools the user switched off for this connector, by original tool name. */
function disabledTools(connector: Connector): Set<string> {
  try {
    const raw = connector.disabled_tools ? JSON.parse(connector.disabled_tools) : [];
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

/**
 * Whether a tool writes, as far as the server admits. Only an explicit hint
 * counts: the large majority of servers publish no annotations at all, and
 * treating "unannotated" as "writes" would refuse most of the ecosystem.
 */
export function isWriteTool(annotations?: ToolAnnotations): boolean {
  if (!annotations) return false;
  return annotations.destructiveHint === true || annotations.readOnlyHint === false;
}

// stdio subprocesses get only what they need to run — never the parent's secrets.
const STDIO_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  "USERNAME",
  "OS",
  "PATHEXT",
  "LANG",
  "NODE_ENV",
];

function stdioEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of STDIO_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value != null) env[key] = value;
  }
  return env;
}

async function connect(connector: Connector): Promise<LiveConnection> {
  const cached = liveMap().get(connector.id);
  if (cached) return cached;

  const client = new Client({ name: "liberde", version: "1.0.0" });
  if (connector.transport === "stdio") {
    if (!connector.command) throw new Error("stdio connector has no command");
    const args: string[] = connector.args ? JSON.parse(connector.args) : [];
    await client.connect(
      new StdioClientTransport({
        command: connector.command,
        args,
        env: stdioEnv(),
      })
    );
  } else {
    if (!connector.url) throw new Error("http connector has no url");
    const headers: Record<string, string> = connector.headers
      ? JSON.parse(connector.headers)
      : {};
    const provider = await makeOAuthProvider(connector.id);
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(connector.url), {
          requestInit: { headers },
          authProvider: provider,
        })
      );
    } catch (e) {
      // The server demanded OAuth: the SDK registered a client and produced an
      // authorization URL. Surface it so the UI can send the user's browser there.
      const authUrl =
        provider.pendingAuthUrl ??
        ((await getConnectorOAuth(connector.id)).pending_auth_url as
          | string
          | undefined);
      if (e instanceof UnauthorizedError || authUrl) {
        if (authUrl) throw new AuthorizationRequiredError(authUrl);
      }
      throw e;
    }
  }

  const { tools } = await client.listTools();
  const map = new Map<string, LiveTool>();
  for (const t of tools) {
    map.set(namespacedToolName(connector, t.name), {
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      annotations: t.annotations as ToolAnnotations | undefined,
    });
  }
  const live = { client, tools: map };
  liveMap().set(connector.id, live);
  return live;
}

export function dropConnection(connectorId: string) {
  const live = liveMap().get(connectorId);
  if (live) {
    live.client.close().catch(() => {});
    liveMap().delete(connectorId);
  }
}

export async function testConnector(
  connector: Connector
): Promise<{
  ok: boolean;
  toolCount?: number;
  tools?: DiscoveredTool[];
  error?: string;
  needsAuth?: boolean;
  authUrl?: string;
}> {
  try {
    dropConnection(connector.id); // force a fresh connection for an honest test
    const live = await connect(connector);
    const tools = [...live.tools.values()].map((t) => ({
      name: t.name,
      description: t.description ?? "",
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }));
    return { ok: true, toolCount: tools.length, tools };
  } catch (e) {
    dropConnection(connector.id);
    if (e instanceof AuthorizationRequiredError) {
      return { ok: false, needsAuth: true, authUrl: e.authUrl, error: "Authorization required" };
    }
    return { ok: false, error: String(e).slice(0, 300) };
  }
}

/** Complete the OAuth flow with the authorization code from the callback. */
export async function finishConnectorAuth(connector: Connector, code: string) {
  if (!connector.url) throw new Error("Not an HTTP connector");
  const provider = await makeOAuthProvider(connector.id);
  const transport = new StreamableHTTPClientTransport(new URL(connector.url), {
    authProvider: provider,
  });
  await transport.finishAuth(code);
  dropConnection(connector.id); // next use reconnects with the fresh tokens
}

/**
 * Assemble the tool list offered to the model: every enabled connector's MCP
 * tools (namespaced, minus any the user switched off) plus one lightweight
 * "skill" tool per enabled skill — invoking a skill returns its full
 * instructions (progressive disclosure).
 */
export async function assembleTools(userId?: string): Promise<{
  tools: ToolDef[];
  errors: string[];
}> {
  const tools: ToolDef[] = [];
  const errors: string[] = [];

  for (const connector of (await listConnectors(userId)).filter((c) => c.enabled)) {
    try {
      const live = await connect(connector);
      const off = disabledTools(connector);
      for (const [namespaced, t] of live.tools) {
        if (off.has(t.name)) continue;
        // Tell the model up front when a tool needs approval it doesn't have,
        // so it plans around the tool instead of calling it and reading an error.
        const gated = !connector.auto_run && isWriteTool(t.annotations);
        const notes = [
          t.annotations?.readOnlyHint === true ? "read-only" : "",
          gated ? "REQUIRES APPROVAL — not currently allowed to run" : "",
        ].filter(Boolean);
        tools.push({
          type: "function",
          function: {
            name: namespaced,
            description: `[${connector.name}]${notes.length ? ` (${notes.join("; ")})` : ""} ${t.description}`.slice(
              0,
              1000
            ),
            parameters: (t.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          },
        });
      }
    } catch (e) {
      errors.push(`${connector.name}: ${String(e).slice(0, 150)}`);
      dropConnection(connector.id);
    }
  }

  for (const skill of (await listSkills(userId)).filter((s) => s.enabled)) {
    tools.push({
      type: "function",
      function: {
        name: `skill__${skill.id.replaceAll("-", "")}`,
        description: `Load the "${skill.name}" skill: ${skill.description}. Call this when the task matches; it returns detailed instructions to follow.`.slice(
          0,
          1000
        ),
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
  }

  return { tools, errors };
}

/** Cap on a single tool result fed back into the model's context. */
const MAX_TOOL_OUTPUT = 8000;

/** Raster formats only. An MCP server is untrusted, and /img/<id> echoes the
 *  stored mime back on our own origin — letting a server bank an
 *  `image/svg+xml` (or anything script-bearing) there would be stored XSS. */
const STORABLE_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

interface ContentPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  description?: string;
  resource?: { uri?: string; mimeType?: string; text?: string; blob?: string };
}

const approxKb = (base64: string) => Math.round((base64.length * 3) / 4 / 1024);

/**
 * Flatten one MCP tool result into the text a chat-completions `tool` message
 * can carry. Every content type the spec defines is represented: previously
 * anything that wasn't `text` collapsed to a bare `[image content]` marker, so
 * an image, an embedded resource or a resource link was silently thrown away.
 *
 * Images are banked as generated images and handed back as a URL, which makes
 * them renderable in the reply instead of merely mentioned.
 */
export async function flattenContent(
  parts: ContentPart[],
  userId?: string,
  origin?: string
): Promise<string> {
  const out: string[] = [];
  for (const p of parts) {
    switch (p.type) {
      case "text":
        out.push(p.text ?? "");
        break;

      case "image": {
        const mime = p.mimeType ?? "image/png";
        if (p.data && userId && origin && STORABLE_IMAGE_MIME.has(mime)) {
          try {
            const id = await saveGeneratedImage(userId, mime, p.data);
            out.push(`![tool image](${origin}/img/${id})`);
            break;
          } catch {
            // Fall through to describing it rather than losing the turn.
          }
        }
        out.push(`[image returned: ${mime}, ~${approxKb(p.data ?? "")} KB]`);
        break;
      }

      case "audio":
        out.push(`[audio returned: ${p.mimeType ?? "unknown"}, ~${approxKb(p.data ?? "")} KB]`);
        break;

      case "resource_link":
        out.push(
          `[resource] ${p.name ?? p.uri ?? "unnamed"}${p.uri ? ` — ${p.uri}` : ""}${
            p.mimeType ? ` (${p.mimeType})` : ""
          }${p.description ? `\n${p.description}` : ""}`
        );
        break;

      case "resource": {
        const r = p.resource ?? {};
        if (r.text) {
          out.push(`[resource ${r.uri ?? ""}]\n${r.text}`);
        } else {
          out.push(
            `[binary resource ${r.uri ?? ""}${r.mimeType ? ` (${r.mimeType})` : ""}, ~${approxKb(
              r.blob ?? ""
            )} KB]`
          );
        }
        break;
      }

      default:
        // An unknown part from a newer server: keep the type visible rather
        // than dropping it, and include any text it happened to carry.
        out.push(p.text ? `[${p.type}] ${p.text}` : `[${p.type} content]`);
    }
  }
  return out.filter(Boolean).join("\n");
}

/** Execute a namespaced tool call (MCP tool or skill load) and return text output. */

/** Argument names only. Values can hold customer data or credentials, and
 *  the audit log outlives the conversation by years — the shape of a call is
 *  enough to review it, the payload is a liability. */
function auditArgKeys(argsJson: string): string[] {
  try {
    const parsed = JSON.parse(argsJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.keys(parsed).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export async function callTool(
  namespacedName: string,
  argsJson: string,
  userId?: string,
  origin?: string
): Promise<string> {
  await audit({
    action: "tool.called",
    userId: userId ?? null,
    targetType: "tool",
    targetId: namespacedName,
    detail: { args: auditArgKeys(argsJson) },
  });
  if (namespacedName.startsWith("skill__")) {
    const id = namespacedName.slice("skill__".length);
    const skill =
      (await listSkills(userId)).find((s) => s.id.replaceAll("-", "") === id) ??
      (await getSkill(id));
    if (!skill) return "Error: skill not found";
    let out = `# Skill: ${skill.name}\n\nFollow these instructions for the current task:\n\n${skill.instructions}`;

    // Surface the exact tools this skill bundles, by their callable (namespaced)
    // names, so the model uses the right connectors for the job.
    let cids: string[] = [];
    try {
      cids = skill.connector_ids ? JSON.parse(skill.connector_ids) : [];
    } catch {
      cids = [];
    }
    if (cids.length) {
      const all = await listConnectors(userId);
      const lines: string[] = [];
      for (const cid of cids) {
        const c = all.find((x) => x.id === cid);
        if (!c || !c.enabled) continue;
        const off = disabledTools(c);
        let cached: DiscoveredTool[] = [];
        try {
          cached = c.tools_cache ? JSON.parse(c.tools_cache) : [];
        } catch {
          cached = [];
        }
        for (const t of cached) {
          if (off.has(t.name)) continue;
          lines.push(
            `- \`${namespacedToolName(c, t.name)}\` — ${t.description}`.slice(0, 300)
          );
        }
      }
      if (lines.length) {
        out += `\n\n## Tools for this skill\nPrefer these connected tools to carry it out:\n${lines.join("\n")}`;
      }
    }

    // Also surface any custom HTTP tools this skill bundles.
    let hids: string[] = [];
    try {
      hids = skill.http_tool_ids ? JSON.parse(skill.http_tool_ids) : [];
    } catch {
      hids = [];
    }
    if (hids.length) {
      const allHttp = await listHttpTools(userId ?? "local");
      const hlines = allHttp
        .filter((t) => hids.includes(t.id) && t.enabled)
        .map((t) => `- \`${t.name}\` — ${t.description}`.slice(0, 300));
      if (hlines.length) {
        out += `\n\n## Custom API tools for this skill\nUse these to carry it out:\n${hlines.join("\n")}`;
      }
    }
    return out;
  }

  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return "Error: tool arguments were not valid JSON";
  }

  for (const connector of (await listConnectors(userId)).filter((c) => c.enabled)) {
    const live = liveMap().get(connector.id) ?? (await connect(connector).catch(() => null));
    if (!live) continue;
    const tool = live.tools.get(namespacedName);
    if (!tool) continue;

    // A tool the user switched off must not be reachable even if the model
    // remembers its name from an earlier turn.
    if (disabledTools(connector).has(tool.name)) {
      return `Error: "${tool.name}" is switched off for the "${connector.name}" connector. Do not call it again; ask the user to re-enable it in Settings → Connectors.`;
    }

    // Write-guard, mirroring custom HTTP tools: a server that declares a tool
    // as writing/destructive only runs once the user has allowed this connector
    // to act on its own.
    if (!connector.auto_run && isWriteTool(tool.annotations)) {
      return `Error: "${tool.name}" is marked as modifying data on the "${connector.name}" server, and that connector is set to require approval. Ask the user to enable "Let the model run write actions" for it in Settings → Connectors.`;
    }

    try {
      const result = await live.client.callTool({ name: tool.name, arguments: args });
      const base = origin ?? (await getSetting("base_url")) ?? undefined;
      let text = await flattenContent(
        (result.content ?? []) as ContentPart[],
        userId,
        base
      );

      // A tool with an outputSchema returns its real payload here, and may send
      // no content parts at all — without this the result read as empty.
      if (result.structuredContent != null) {
        const structured = JSON.stringify(result.structuredContent, null, 2);
        text = text ? `${text}\n\n${structured}` : structured;
      }

      const output = text || JSON.stringify(result);
      if (result.isError) return `Error: ${output.slice(0, MAX_TOOL_OUTPUT)}`;
      return output.length > MAX_TOOL_OUTPUT
        ? `${output.slice(0, MAX_TOOL_OUTPUT)}\n…(truncated)`
        : output;
    } catch (e) {
      dropConnection(connector.id);
      return `Error calling tool: ${String(e).slice(0, 300)}`;
    }
  }
  return `Error: no connected server provides tool "${namespacedName}"`;
}
