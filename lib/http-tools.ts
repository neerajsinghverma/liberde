// User-defined REST endpoints exposed to the model as callable tools.
// Both the manual builder and OpenAPI import produce HttpTool records; this
// module turns them into tool defs and executes calls (with SSRF + response caps).

import type { HttpTool, HttpToolParam } from "./types";
import type { ToolDef } from "./mcp";
import { getHttpToolByName, listHttpTools } from "./db";
import { guardedFetch } from "./ssrf";
import { authForced } from "./auth";
import { audit } from "./audit";

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

const JSON_TYPE: Record<HttpToolParam["type"], string> = {
  string: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
};

/** Build the LLM-visible tool definition for one HTTP tool. */
export function httpToolDef(t: HttpTool): ToolDef {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of t.params) {
    properties[p.name] = {
      type: JSON_TYPE[p.type] ?? "string",
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(p.name);
  }
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description || `Call the ${t.name} endpoint.`,
      parameters: { type: "object", properties, required },
    },
  };
}

/** Load a user's enabled HTTP tools as defs + a name set for dispatch. */
export async function assembleHttpTools(
  userId: string
): Promise<{ defs: ToolDef[]; names: Set<string> }> {
  const tools = (await listHttpTools(userId, true)).filter((t) => t.enabled);
  return {
    defs: tools.map(httpToolDef),
    names: new Set(tools.map((t) => t.name)),
  };
}

const interp = (tpl: string, args: Record<string, unknown>) =>
  tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) =>
    args[k] != null ? String(args[k]) : ""
  );

/** Build the concrete request (url/method/headers/body) from a tool + model args. */
export function buildHttpRequest(
  tool: HttpTool & { auth_secret?: string | null },
  args: Record<string, unknown>
): { url: string; method: string; headers: Record<string, string>; body?: string } {
  const method = (tool.method || "GET").toUpperCase();
  const headers: Record<string, string> = { ...(tool.headers || {}) };
  const query = new URLSearchParams();
  const bodyObj: Record<string, unknown> = {};

  // Path placeholders first (encode), then distribute the rest by location.
  let url = interp(tool.url_template, args);
  for (const p of tool.params) {
    const v = args[p.name];
    if (v == null) continue;
    if (p.location === "query") query.set(p.name, String(v));
    else if (p.location === "header") headers[p.name] = String(v);
    else if (p.location === "body") bodyObj[p.name] = v;
    // path params were already interpolated into the URL
  }

  // Auth.
  const secret = tool.auth_secret ?? "";
  const a = tool.auth;
  if (a?.type === "bearer" && secret) headers["Authorization"] = `Bearer ${secret}`;
  else if (a?.type === "basic" && secret)
    headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
  else if (a?.type === "apiKey" && secret && a.name) {
    if (a.in === "query") query.set(a.name, secret);
    else headers[a.name] = secret;
  }

  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (tool.body_mode === "template" && tool.body_template) {
      body = interp(tool.body_template, args);
    } else if (Object.keys(bodyObj).length) {
      body = JSON.stringify(bodyObj);
    }
    if (body && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }
  return { url, method, headers, body };
}

/** Extract a dot-path (e.g. "data.items") from a parsed JSON response, best-effort. */
function extractPath(text: string, path: string): string {
  try {
    let cur: unknown = JSON.parse(text);
    for (const key of path.split(".")) {
      if (cur == null) break;
      cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === "string" ? cur : JSON.stringify(cur, null, 2);
  } catch {
    return text; // not JSON / bad path — return as-is
  }
}

/**
 * Perform one HTTP-tool call. Shared by the runtime dispatcher and the "Test"
 * button. Never throws — returns a string result (or a clean error string).
 */
export async function performHttpCall(
  tool: HttpTool & { auth_secret?: string | null },
  args: Record<string, unknown>
): Promise<string> {
  const req = buildHttpRequest(tool, args);
  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    return `Error: the tool produced an invalid URL: ${req.url}`;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return `Error: only http/https URLs are allowed.`;
  }
  // SSRF guard on the public (multi-user) deployment; self-host may hit private
  // hosts. guardedFetch re-checks the host on every redirect hop (so a public
  // URL can't 302 into internal space) and drops the auth header if a redirect
  // crosses to another host (so it can't leak the API key).
  const a = tool.auth;
  const sensitiveHeaders =
    a?.type === "apiKey" && a.in !== "query" && a.name ? [a.name] : [];
  try {
    const res = await guardedFetch(
      target,
      {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(20_000),
      },
      { guard: authForced(), sensitiveHeaders }
    );
    let text = await res.text();
    const cap = tool.max_response_bytes || 24576;
    let truncated = false;
    if (text.length > cap) {
      text = text.slice(0, cap);
      truncated = true;
    }
    if (tool.response_extract) text = extractPath(text, tool.response_extract);
    return `HTTP ${res.status} ${res.statusText}\n${text}${truncated ? "\n…(truncated)" : ""}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^Blocked:/.test(msg)) return `Error: ${msg}`;
    return `Error calling the endpoint: ${/aborted|timeout/i.test(msg) ? "request timed out (20s)" : msg}`;
  }
}

/** Runtime dispatcher: look up the named tool for the user and execute it. */
export async function execHttpTool(
  name: string,
  argsJson: string,
  userId: string
): Promise<string> {
  await audit({
    action: "tool.called",
    userId,
    targetType: "http_tool",
    targetId: name,
    detail: { args: auditArgKeys(argsJson) },
  });
  const tool = await getHttpToolByName(userId, name);
  if (!tool) return `Error: no HTTP tool named "${name}".`;
  const method = (tool.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !tool.auto_run) {
    return `Error: "${name}" is a ${method} request that can modify data, and it is set to require approval. Ask the user to enable "Let the model run this automatically" on the tool in Settings → Custom tools.`;
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    /* tolerate empty/garbage args */
  }
  return performHttpCall(tool, args);
}
