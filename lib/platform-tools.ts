// Platform tools: model-callable tools that let the assistant manage the
// platform itself mid-conversation — connect an MCP server the user pastes in
// chat, save a reusable skill, or inspect what's already connected.
//
// This file is shared verbatim between the local (sqlite/sync db) and cloud
// (postgres/async db) codebases: every db call is awaited, and awaiting a
// sync return value is harmless.
import {
  createConnector,
  createSkill,
  deleteConnector,
  listConnectors,
  listSkills,
  setConnectorTools,
  setSetting,
} from "./db";
import { testConnector, type ToolDef } from "./mcp";
import { assertPublicHost } from "./ssrf";

export const PLATFORM_TOOLS_PROMPT = `# Connecting MCP servers & skills yourself
When the user shares an MCP server (a URL, optionally with a bearer token / API key, or a local command) and asks to connect, add, or use it — call connect_mcp_server yourself instead of sending them to Settings. When the user wants to save reusable instructions for a recurring task, call create_skill. Use list_connections first if you need to check what is already connected. After connect_mcp_server succeeds, the server's tools are available to you immediately in this same conversation — call them directly. If the result says authorization is required, give the user the authorization link, ask them to approve it, and tell them the connection finishes automatically once they do.`;

export const PLATFORM_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "connect_mcp_server",
      description:
        "Connect a new MCP server so its tools become available. Use when the user shares an MCP server URL (remote/HTTP) or a local command (stdio) and asks to connect it. Verifies the connection and returns the discovered tools, or an authorization link if the server requires OAuth.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short human-readable name for the server (e.g. \"GitHub\", \"Linear\").",
          },
          url: {
            type: "string",
            description: "The MCP server URL (http/https) for remote servers.",
          },
          bearerToken: {
            type: "string",
            description: "Optional bearer token / API key if the user provided one.",
          },
          command: {
            type: "string",
            description: "For local stdio servers only: the executable (e.g. \"npx\").",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "For local stdio servers only: the command arguments.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_skill",
      description:
        "Save a reusable skill: a named set of instructions the assistant can load in future chats when the task matches. Use when the user shares a skill or asks to remember a repeatable procedure/workflow.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short unique skill name." },
          description: {
            type: "string",
            description: "One line describing when this skill should be used.",
          },
          instructions: {
            type: "string",
            description: "The full instructions (markdown) to follow when the skill is invoked.",
          },
          connectorNames: {
            type: "array",
            items: { type: "string" },
            description: "Optional: names of already-connected MCP servers this skill relies on.",
          },
        },
        required: ["name", "description", "instructions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_connections",
      description:
        "List the MCP servers and skills currently configured, with their status and tools. Use to check whether something is already connected before adding it.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

const PLATFORM_TOOL_NAMES = new Set(PLATFORM_TOOL_DEFS.map((t) => t.function.name));

export function isPlatformTool(name: string): boolean {
  return PLATFORM_TOOL_NAMES.has(name);
}

export interface PlatformToolResult {
  output: string;
  /** True when connectors/skills changed and the chat loop should re-assemble its tool list. */
  toolsChanged: boolean;
}

export async function execPlatformTool(
  name: string,
  argsJson: string,
  userId?: string,
  /** Request origin, used to register the OAuth redirect URI for new connectors. */
  origin?: string
): Promise<PlatformToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { output: "Error: tool arguments were not valid JSON", toolsChanged: false };
  }

  try {
    if (name === "connect_mcp_server") return await connectMcpServer(args, userId, origin);
    if (name === "create_skill") return await createSkillTool(args, userId);
    if (name === "list_connections") return await listConnections(userId);
  } catch (e) {
    return { output: `Error: ${String(e).slice(0, 300)}`, toolsChanged: false };
  }
  return { output: `Error: unknown platform tool "${name}"`, toolsChanged: false };
}

async function connectMcpServer(
  args: Record<string, unknown>,
  userId?: string,
  origin?: string
): Promise<PlatformToolResult> {
  const name = String(args.name ?? "").trim();
  const url = args.url ? String(args.url).trim() : "";
  const command = args.command ? String(args.command).trim() : "";
  const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  const bearerToken = args.bearerToken ? String(args.bearerToken).trim() : "";

  if (!name) return { output: "Error: name is required", toolsChanged: false };
  const transport: "http" | "stdio" = url ? "http" : "stdio";
  if (transport === "http") {
    if (!/^https?:\/\//i.test(url)) {
      return { output: "Error: url must start with http:// or https://", toolsChanged: false };
    }
    // SSRF guard for model-initiated connections: a prompt-injected model
    // could be steered to connect an internal URL. On hosted deployments,
    // block private/loopback targets. (Local single-user installs skip this so
    // the owner can still connect localhost MCP servers on their own machine.)
    if (process.env.VERCEL) {
      try {
        await assertPublicHost(new URL(url));
      } catch (e) {
        return {
          output: `Error: refusing to connect to a non-public address (${String(e).slice(0, 120)}).`,
          toolsChanged: false,
        };
      }
    }
  } else {
    if (!command) {
      return { output: "Error: provide either a url (remote server) or a command (local stdio server)", toolsChanged: false };
    }
    if (process.env.VERCEL) {
      return {
        output:
          "Error: local stdio MCP servers aren't supported on this hosted deployment — only remote (URL-based) servers can be connected here.",
        toolsChanged: false,
      };
    }
  }

  // Already connected? Don't create a duplicate — retest and report.
  const existing = (await listConnectors(userId)).find((c) =>
    transport === "http"
      ? c.url && c.url.replace(/\/+$/, "") === url.replace(/\/+$/, "")
      : c.command === command && (c.args ?? "[]") === JSON.stringify(cmdArgs)
  );
  if (existing) {
    const result = await testConnector(existing);
    if (result.ok && result.tools) await setConnectorTools(existing.id, result.tools);
    return {
      output: result.ok
        ? `Already connected as "${existing.name}" (${result.toolCount} tools):\n${(result.tools ?? [])
            .map((t) => `- ${t.name}: ${t.description}`.slice(0, 200))
            .join("\n")}`
        : result.needsAuth
          ? `"${existing.name}" is already added but needs authorization. Give the user this link to approve access: ${result.authUrl}\nThe connection completes automatically after they authorize.`
          : `"${existing.name}" is already added but the connection failed: ${result.error}`,
      toolsChanged: result.ok === true,
    };
  }

  // Remember our public origin so OAuth redirect URIs are registered correctly.
  if (origin) await setSetting("base_url", origin);

  const connector = await createConnector(
    {
      name,
      transport,
      url: url || null,
      command: command || null,
      args: transport === "stdio" ? JSON.stringify(cmdArgs) : null,
      headers: bearerToken ? JSON.stringify({ Authorization: `Bearer ${bearerToken}` }) : null,
    },
    userId
  );

  const result = await testConnector(connector);
  if (result.ok) {
    if (result.tools) await setConnectorTools(connector.id, result.tools);
    return {
      output: `Connected "${name}" (${result.toolCount} tools). These tools are available to you right now — call them directly:\n${(result.tools ?? [])
        .map((t) => `- ${t.name}: ${t.description}`.slice(0, 200))
        .join("\n")}`,
      toolsChanged: true,
    };
  }
  if (result.needsAuth && result.authUrl) {
    // Keep the connector: authorization completes via the OAuth callback.
    return {
      output: `"${name}" was added but requires authorization. Give the user this link and ask them to approve access: ${result.authUrl}\nAfter they authorize, the server's tools become available automatically (from their next message).`,
      toolsChanged: false,
    };
  }
  // Dead server: don't leave a broken connector behind.
  await deleteConnector(connector.id);
  return {
    output: `Error: could not connect to "${name}": ${result.error}. Nothing was saved — check the URL${bearerToken ? "/token" : ""} with the user and try again.`,
    toolsChanged: false,
  };
}

async function createSkillTool(
  args: Record<string, unknown>,
  userId?: string
): Promise<PlatformToolResult> {
  const name = String(args.name ?? "").trim();
  const description = String(args.description ?? "").trim();
  const instructions = String(args.instructions ?? "").trim();
  if (!name || !description || !instructions) {
    return { output: "Error: name, description and instructions are all required", toolsChanged: false };
  }
  const skills = await listSkills(userId);
  if (skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return {
      output: `Error: a skill named "${name}" already exists. Pick a different name, or tell the user the skill is already saved.`,
      toolsChanged: false,
    };
  }

  // Resolve optional connector references by name (or id) against what exists.
  const wanted = Array.isArray(args.connectorNames) ? args.connectorNames.map(String) : [];
  const connectors = await listConnectors(userId);
  const connectorIds = wanted
    .map(
      (w) =>
        connectors.find((c) => c.name.toLowerCase() === w.toLowerCase() || c.id === w)?.id
    )
    .filter((id): id is string => Boolean(id));

  await createSkill({ name, description, instructions, connectorIds }, userId);
  return {
    output: `Skill "${name}" saved and enabled. It will be offered to you as a loadable tool in every chat; call it whenever the task matches: ${description}`,
    toolsChanged: true,
  };
}

async function listConnections(userId?: string): Promise<PlatformToolResult> {
  const connectors = await listConnectors(userId);
  const skills = await listSkills(userId);
  const lines: string[] = [];
  lines.push(`MCP servers (${connectors.length}):`);
  for (const c of connectors) {
    let toolCount = 0;
    try {
      toolCount = c.tools_cache ? (JSON.parse(c.tools_cache) as unknown[]).length : 0;
    } catch {
      toolCount = 0;
    }
    lines.push(
      `- ${c.name} [${c.transport}${c.enabled ? "" : ", disabled"}] ${
        c.url ?? c.command ?? ""
      } — ${toolCount} tools`
    );
  }
  lines.push("");
  lines.push(`Skills (${skills.length}):`);
  for (const s of skills) {
    lines.push(`- ${s.name}${s.enabled ? "" : " [disabled]"} — ${s.description}`);
  }
  return { output: lines.join("\n"), toolsChanged: false };
}
