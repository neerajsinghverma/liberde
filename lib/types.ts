export interface Attachment {
  name: string;
  mime: string;
  /** data URL for images; plain extracted text for text files */
  dataUrl?: string;
  text?: string;
}

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
  created_at: number;
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
  monthlyBudget: number;
  temperature: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supportsImages: boolean;
  supportsTools: boolean;
  outputsImages: boolean;
  /** Unix seconds the model was added to OpenRouter. */
  created: number;
}
