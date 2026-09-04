export interface Attachment {
  name: string;
  mime: string;
  /** data URL for images; plain extracted text for text files */
  dataUrl?: string;
  text?: string;
}

/**
 * Behaviour hints an MCP server may attach to a tool. Hints only — the spec is
 * explicit that a client MUST NOT treat them as a security boundary, since they
 * come from the same server the call goes to. They drive the default
 * write-guard and the labels in Settings; the real control is per-tool
 * disabling, which is enforced client-side and never reaches the server.
 *
 * Lives here rather than in lib/mcp.ts so lib/db.ts can type the tool cache
 * without importing lib/mcp (which already imports lib/db).
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One tool discovered on a connector, as cached after a successful test. */
export interface DiscoveredTool {
  name: string;
  description: string;
  annotations?: ToolAnnotations;
}

/**
 * Stored in `Attachment.text` when a PDF's text layer held nothing to read.
 * Lives here rather than in lib/pdf.ts so consumers can check for it without
 * pulling pdf-parse (and pdf.js) into their bundle.
 */
export const PDF_NO_TEXT = "(no extractable text in this PDF)";

/** Word documents. A zip, so it needs server-side parsing like a PDF. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Stored in `Attachment.text` when a DOCX parsed fine but held no prose. */
export const DOCX_NO_TEXT = "(no extractable text in this document)";

/**
 * Legacy Word. The extension is unreliable — plenty of ".doc" files are actually
 * MHTML web archives or HTML exports — so lib/doc.ts sniffs the real format.
 */
export const DOC_MIME = "application/msword";

/** Stored in `Attachment.text` when a legacy .doc held nothing we can read. */
export const DOC_NO_TEXT =
  "(this file could not be read — it is not a recognized Word document; try converting it to PDF or DOCX)";

export interface UrlCitation {
  type: "url_citation";
  url_citation: {
    url: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AgentStep {
  title: string;
  status: "pending" | "done" | "failed";
  note?: string;
  /**
   * Steps sharing a group run concurrently; groups run in ascending order.
   * Optional because runs planned before grouping existed are already
   * persisted without it — those fall back to one step per group, which is
   * the sequential behaviour they were planned under.
   */
  group?: number;
}

/** A durable, resumable agent run: its plan and progress are persisted so a
 *  serverless timeout can be continued rather than losing all work. */
export interface AgentRun {
  id: string;
  conversation_id: string;
  user_id: string;
  goal: string;
  model: string;
  planner_model: string;
  exec_model: string;
  status: "running" | "synthesizing" | "done" | "error";
  steps: AgentStep[];
  current_step: number;
  notes: string[];
  run_msg_id: string | null;
  total_cost: number;
  context_block: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model: string | null;
  attachments: Attachment[] | null;
  reasoning?: string | null;
  annotations?: UrlCitation[] | null;
  /** Generated images as data URLs. */
  images?: string[] | null;
  /** Tool calls this assistant message made. */
  tool_calls?: unknown[] | null;
  /** For role "tool": which call this message answers. */
  tool_call_id?: string | null;
  /** How long the model spent thinking before answering, in ms. */
  reasoning_ms?: number | null;
  /** What this turn cost in USD (all rounds + tool sub-calls), and its tokens. */
  cost?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  /** Input tokens served from the provider's prompt cache this turn. */
  cached_tokens_in?: number | null;
  /** USD OpenRouter reports as saved by that cache (negative on a write). */
  cache_discount?: number | null;
  /** JSON {"model":n,"search":n,"image":n} — where this turn's cost went. */
  cost_breakdown?: string | null;
  /** Wall-clock generation time for this assistant turn. */
  duration_ms?: number | null;
  /** When Auto-routed: short reason the router chose this model (e.g. "complex reasoning"). */
  route_reason?: string | null;
  created_at: number;
}

export interface HttpToolParam {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  required?: boolean;
  /** Where the value goes in the request. */
  location: "path" | "query" | "body" | "header";
}

export interface HttpToolAuth {
  type: "none" | "bearer" | "apiKey" | "basic";
  /** apiKey only: where the key is sent. */
  in?: "header" | "query";
  /** apiKey only: the header/query name (e.g. "X-Api-Key"). */
  name?: string;
  /** To the client only: whether a secret value is stored (never the value itself). */
  hasSecret?: boolean;
}

/** A user-defined REST endpoint exposed to the model as a callable tool. */
export interface HttpTool {
  id: string;
  user_id: string;
  name: string;
  description: string;
  method: string; // GET | POST | PUT | PATCH | DELETE
  url_template: string; // https://api.x.com/v1/users/{{id}}
  params: HttpToolParam[];
  headers: Record<string, string>; // static headers
  auth: HttpToolAuth;
  body_mode: "auto" | "template";
  body_template: string | null;
  response_extract: string | null; // dot-path to trim the response (e.g. "data.items")
  max_response_bytes: number;
  /** Writes (non-GET) only run when the user has allowed it. */
  auto_run: number;
  source: "manual" | "openapi";
  openapi_group: string | null;
  enabled: number;
  created_at: number;
}

export interface DesignSystem {
  id: string;
  user_id: string;
  name: string;
  /** Markdown spec the model consumes: palette, typography, spacing, components, voice. */
  spec: string;
  /** JSON array of hex colors for UI preview swatches. */
  palette: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
  /** Present on systems shared with the requesting user (read-only for them). */
  owner_name?: string;
  shared?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  project_id: string | null;
  is_temp?: number;
  starred?: number;
  archived?: number;
  user_id?: string;
  /** "chat" (default) or "design" — the Design workspace scopes to its own convos. */
  mode?: string;
  /** Design mode: the design system applied to artifacts built in this conversation. */
  design_system_id?: string | null;
  /** The agent this conversation was started as, if any (see /api/agents). */
  agent_id?: string | null;
  /** Set while a response is generating (lock timestamp); cleared when done. */
  locked_at?: number | null;
  /** Computed by the conversation GET: a response is currently being generated. */
  generating?: boolean;
  created_at: number;
  updated_at: number;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  content: string;
  created_at: number;
}

export interface AppSettings {
  apiKey: string;
  /** true when a key is configured (key itself is never sent to the client) */
  hasApiKey?: boolean;
  defaultModel: string;
  titleModel: string;
  imageModel: string;
  transcribeModel: string;
  plannerModel: string;
  agentExecModel: string;
  systemPrompt: string;
  aboutUser: string;
  styleInstructions: string;
  responseStyle: string;
  memoryEnabled: boolean;
  /** Let the model search the user's own past chats (search_past_chats tool). */
  recallEnabled: boolean;
  temperature: number;
  /** true when an embeddings key is configured (the key itself never leaves the server) */
  hasEmbeddingKey?: boolean;
  /** OpenAI-compatible /embeddings base URL; blank means the OpenAI default. */
  embeddingBaseUrl?: string;
  embeddingModel?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supportsImages: boolean;
  supportsTools: boolean;
  /** Model can be held to a JSON Schema via `response_format`. */
  supportsStructuredOutputs: boolean;
  outputsImages: boolean;
  /** Unix seconds the model was added to OpenRouter. */
  created: number;
}
