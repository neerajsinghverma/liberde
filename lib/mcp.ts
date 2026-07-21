import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConnectorOAuth, getSkill, listConnectors, listSkills, type Connector } from "./db";
import { AuthorizationRequiredError, makeOAuthProvider } from "./mcp-oauth";

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface LiveConnection {
  client: Client;
  /** original tool name by namespaced name */
  tools: Map<string, { name: string; description: string; inputSchema: unknown }>;
}

const liveKey = "__liberdeMcp";
function liveMap(): Map<string, LiveConnection> {
  const g = globalThis as unknown as { [liveKey]?: Map<string, LiveConnection> };
  if (!g[liveKey]) g[liveKey] = new Map();
  return g[liveKey]!;
}

const sanitize = (s: string) =>
  s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "server";

/** Unique per-connector prefix: readable name + id fragment so two connectors never collide. */
const connectorPrefix = (c: Connector) =>
  `${sanitize(c.name)}_${c.id.replaceAll("-", "").slice(0, 6)}`;

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
  const map = new Map<string, { name: string; description: string; inputSchema: unknown }>();
  for (const t of tools) {
    map.set(`${connectorPrefix(connector)}__${sanitize(t.name)}`, {
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
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
  tools?: { name: string; description: string }[];
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
 * tools (namespaced) plus one lightweight "skill" tool per enabled skill —
 * invoking a skill returns its full instructions (progressive disclosure).
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
      for (const [namespaced, t] of live.tools) {
        tools.push({
          type: "function",
          function: {
            name: namespaced,
            description: `[${connector.name}] ${t.description}`.slice(0, 1000),
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

/** Execute a namespaced tool call (MCP tool or skill load) and return text output. */
export async function callTool(
  namespacedName: string,
  argsJson: string,
  userId?: string
): Promise<string> {
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
        let cached: { name: string; description: string }[] = [];
        try {
          cached = c.tools_cache ? JSON.parse(c.tools_cache) : [];
        } catch {
          cached = [];
        }
        for (const t of cached) {
          lines.push(
            `- \`${connectorPrefix(c)}__${sanitize(t.name)}\` — ${t.description}`.slice(0, 300)
          );
        }
      }
      if (lines.length) {
        out += `\n\n## Tools for this skill\nPrefer these connected tools to carry it out:\n${lines.join("\n")}`;
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
    try {
      const result = await live.client.callTool({ name: tool.name, arguments: args });
      const parts = (result.content ?? []) as { type: string; text?: string }[];
      const text = parts
        .map((p) => (p.type === "text" ? p.text : `[${p.type} content]`))
        .join("\n");
      const output = text || JSON.stringify(result);
      return result.isError ? `Error: ${output}` : output.slice(0, 8000);
    } catch (e) {
      dropConnection(connector.id);
      return `Error calling tool: ${String(e).slice(0, 300)}`;
    }
  }
  return `Error: no connected server provides tool "${namespacedName}"`;
}
