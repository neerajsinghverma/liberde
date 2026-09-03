// External model providers beyond OpenRouter: Azure AI Foundry, AWS Bedrock,
// Google (Gemini / Vertex), and any custom OpenAI-compatible endpoint.
// All of them speak the OpenAI chat-completions dialect, so routing is just
// (url, headers, model-name) resolution; model ids are namespaced "ext:{providerId}:{model}".

import { getProvider, listProviders, type ProviderRecord } from "./db";
import { openRouterHeaders, OPENROUTER_BASE } from "./openrouter";
import { signAwsRequest } from "./aws-sigv4";
import type { ModelInfo } from "./types";

export interface ProviderConfig {
  apiKey?: string;
  /** Azure resource endpoint (https://xxx.openai.azure.com) or custom base URL. */
  endpoint?: string;
  /** Azure api-version. */
  apiVersion?: string;
  /** Bedrock region (us-east-1 …). */
  region?: string;
  /** Bedrock IAM credentials (classic access key + secret, signed with SigV4).
   *  When present these take precedence over a Bedrock API key. */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Model/deployment names the user wants exposed. */
  models?: string[];
  /** Optional $ per 1M input tokens — enables estimated cost tracking. */
  promptPrice?: number;
  /** Optional $ per 1M output tokens. */
  completionPrice?: number;
}

export const EXT_PREFIX = "ext:";

export const parseExtModel = (
  modelId: string
): { providerId: string; model: string } | null => {
  if (!modelId.startsWith(EXT_PREFIX)) return null;
  const rest = modelId.slice(EXT_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { providerId: rest.slice(0, sep), model: rest.slice(sep + 1) };
};

export function providerConfig(record: ProviderRecord): ProviderConfig {
  try {
    return JSON.parse(record.config);
  } catch {
    return {};
  }
}

export interface ChatTarget {
  url: string;
  headers: Record<string, string>;
  /** The model value to send in the request body. */
  bodyModel: string;
  isOpenRouter: boolean;
  /** Optional $/1M token prices for estimated cost on external providers. */
  promptPricePerM?: number;
  completionPricePerM?: number;
  /** When set, produces auth headers from the request body (AWS SigV4). The
   *  body must be the exact string sent, so callers apply this at fetch time. */
  sign?: (body: string) => Record<string, string>;
}

/** Final request headers for a target, applying SigV4 signing when required. */
export function targetHeaders(t: ChatTarget, body: string): Record<string, string> {
  return t.sign ? { ...t.headers, ...t.sign(body) } : t.headers;
}

/** Build the chat-completions target for a provider + model. */
export function targetFor(record: ProviderRecord, model: string): ChatTarget {
  const cfg = providerConfig(record);
  const json = { "Content-Type": "application/json" };
  const prices = {
    promptPricePerM: Number(cfg.promptPrice) || undefined,
    completionPricePerM: Number(cfg.completionPrice) || undefined,
  };
  switch (record.kind) {
    case "azure": {
      const endpoint = (cfg.endpoint ?? "").replace(/\/$/, "");
      const apiVersion = cfg.apiVersion || "2024-10-21";
      return {
        url: `${endpoint}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${apiVersion}`,
        headers: { ...json, "api-key": cfg.apiKey ?? "" },
        bodyModel: model,
        isOpenRouter: false,
        ...prices,
      };
    }
    case "bedrock": {
      const region = cfg.region || "us-east-1";
      const url = `https://bedrock-runtime.${region}.amazonaws.com/openai/v1/chat/completions`;
      // Prefer IAM access key + secret (SigV4) when provided; otherwise fall
      // back to a Bedrock API key (bearer token).
      const useSig = Boolean(cfg.accessKeyId && cfg.secretAccessKey);
      return {
        url,
        headers: { ...json, ...(useSig ? {} : { Authorization: `Bearer ${cfg.apiKey ?? ""}` }) },
        bodyModel: model,
        isOpenRouter: false,
        ...(useSig
          ? {
              sign: (body: string) =>
                signAwsRequest({
                  url,
                  region,
                  accessKeyId: cfg.accessKeyId!,
                  secretAccessKey: cfg.secretAccessKey!,
                  sessionToken: cfg.sessionToken,
                  body,
                }),
            }
          : {}),
        ...prices,
      };
    }
    case "google": {
      const base = (cfg.endpoint || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
      return {
        url: `${base}/chat/completions`,
        headers: { ...json, Authorization: `Bearer ${cfg.apiKey ?? ""}` },
        bodyModel: model,
        isOpenRouter: false,
        ...prices,
      };
    }
    case "openai": {
      // Direct OpenAI API (native chat-completions).
      const base = (cfg.endpoint || "https://api.openai.com/v1").replace(/\/$/, "");
      return {
        url: `${base}/chat/completions`,
        headers: { ...json, Authorization: `Bearer ${cfg.apiKey ?? ""}` },
        bodyModel: model,
        isOpenRouter: false,
        ...prices,
      };
    }
    case "anthropic": {
      // Anthropic's OpenAI-compatible endpoint (chat-completions dialect).
      const base = (cfg.endpoint || "https://api.anthropic.com/v1").replace(/\/$/, "");
      return {
        url: `${base}/chat/completions`,
        headers: { ...json, Authorization: `Bearer ${cfg.apiKey ?? ""}` },
        bodyModel: model,
        isOpenRouter: false,
        ...prices,
      };
    }
    default: {
      const base = (cfg.endpoint ?? "").replace(/\/$/, "");
      return {
        url: `${base}/chat/completions`,
        headers: {
          ...json,
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        bodyModel: model,
        isOpenRouter: false,
        ...prices,
      };
    }
  }
}

/**
 * Resolve any model id to its chat endpoint. OpenRouter ids (no ext: prefix)
 * go to OpenRouter with the user's key; ext ids go to their provider.
 */
export async function resolveChatTarget(
  modelId: string,
  userId?: string
): Promise<ChatTarget> {
  const parsed = parseExtModel(modelId);
  if (!parsed) {
    return {
      url: `${OPENROUTER_BASE}/chat/completions`,
      headers: await openRouterHeaders(userId),
      bodyModel: modelId,
      isOpenRouter: true,
    };
  }
  const record = await getProvider(parsed.providerId);
  if (!record || (userId && record.user_id !== userId) || !record.enabled) {
    throw new Error(`Model provider not found or disabled for ${modelId}`);
  }
  return targetFor(record, parsed.model);
}

/** The user's external models, shaped like catalog entries for the picker. */
export async function listExtModels(userId?: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  for (const record of (await listProviders(userId)).filter((p) => p.enabled)) {
    const cfg = providerConfig(record);
    for (const model of cfg.models ?? []) {
      out.push({
        id: `${EXT_PREFIX}${record.id}:${model}`,
        name: `${record.name} · ${model}`,
        description: `${kindLabel(record.kind)} model via the "${record.name}" provider`,
        context_length: 0,
        created: Math.floor(record.created_at / 1000),
        pricing: {
          prompt: String((Number(cfg.promptPrice) || 0) / 1_000_000),
          completion: String((Number(cfg.completionPrice) || 0) / 1_000_000),
        },
        supportsImages: true, // unknown — don't block attachments
        supportsTools: true,
        // The external clouds all speak the OpenAI dialect, and this catalog
        // entry is hand-declared rather than discovered — assume support and
        // let the provider be the one to object.
        supportsStructuredOutputs: true,
        outputsImages: false,
      });
    }
  }
  return out;
}

export const kindLabel = (kind: ProviderRecord["kind"]) =>
  kind === "azure"
    ? "Azure AI Foundry"
    : kind === "bedrock"
      ? "AWS Bedrock"
      : kind === "google"
        ? "Google"
        : kind === "openai"
          ? "OpenAI"
          : kind === "anthropic"
            ? "Anthropic"
            : "OpenAI-compatible";

/** Cheap live check: one-token completion against the first configured model. */
export async function testProvider(
  record: ProviderRecord
): Promise<{ ok: boolean; error?: string }> {
  const cfg = providerConfig(record);
  const model = cfg.models?.[0];
  if (!model) return { ok: false, error: "Add at least one model name first" };
  try {
    const target = targetFor(record, model);
    const pingBody = JSON.stringify({
      model: target.bodyModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    const res = await fetch(target.url, {
      method: "POST",
      headers: targetHeaders(target, pingBody),
      body: pingBody,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
