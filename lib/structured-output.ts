/**
 * `response_format` validation for the platform API.
 *
 * OpenRouter forwards this straight to the upstream provider, so a malformed
 * schema or a model that can't do constrained decoding comes back as an opaque
 * provider error — often a 400 whose body names a field the caller never sent.
 * Checking here turns those into the OpenAI-shaped errors an SDK expects, and
 * says which of the two things actually went wrong.
 */

import { listModels } from "./openrouter";

export interface ResponseFormat {
  type: "json_object" | "json_schema" | "text";
  json_schema?: {
    name?: string;
    strict?: boolean;
    schema?: Record<string, unknown>;
  };
}

/** An OpenAI-dialect error body, ready to return as JSON. */
export interface FormatProblem {
  message: string;
  param: string;
  code: string;
}

const JSON_SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Check the shape of a caller-supplied `response_format`. Returns null when it
 * is absent or fine. Shape only — the schema's own validity is the provider's
 * to judge, since each supports a different JSON Schema subset.
 */
export function validateResponseFormat(value: unknown): FormatProblem | null {
  if (value == null) return null;

  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      message: "`response_format` must be an object.",
      param: "response_format",
      code: "invalid_response_format",
    };
  }

  const rf = value as ResponseFormat;
  if (rf.type !== "json_object" && rf.type !== "json_schema" && rf.type !== "text") {
    return {
      message: '`response_format.type` must be one of "text", "json_object", or "json_schema".',
      param: "response_format.type",
      code: "invalid_response_format",
    };
  }
  if (rf.type !== "json_schema") return null;

  const js = rf.json_schema;
  if (!js || typeof js !== "object" || Array.isArray(js)) {
    return {
      message: '`response_format.json_schema` is required when type is "json_schema".',
      param: "response_format.json_schema",
      code: "invalid_response_format",
    };
  }
  // Providers key their schema cache on this name, and several reject anything
  // outside the identifier charset — a clear message beats their 400.
  if (js.name != null && (typeof js.name !== "string" || !JSON_SCHEMA_NAME.test(js.name))) {
    return {
      message:
        "`response_format.json_schema.name` must be 1-64 characters of letters, digits, underscores, or dashes.",
      param: "response_format.json_schema.name",
      code: "invalid_response_format",
    };
  }
  if (!js.schema || typeof js.schema !== "object" || Array.isArray(js.schema)) {
    return {
      message: "`response_format.json_schema.schema` must be a JSON Schema object.",
      param: "response_format.json_schema.schema",
      code: "invalid_response_format",
    };
  }
  // `strict: true` without a closed root object is the single most common way
  // structured outputs silently return extra keys, so name it up front.
  if (js.strict === true) {
    const schema = js.schema as { type?: unknown; additionalProperties?: unknown };
    if (schema.type === "object" && schema.additionalProperties !== false) {
      return {
        message:
          "`strict: true` requires the root schema to set `additionalProperties: false`.",
        param: "response_format.json_schema.schema.additionalProperties",
        code: "invalid_response_format",
      };
    }
  }
  return null;
}

/**
 * Whether `model` can honour a JSON Schema. Unknown models get the benefit of
 * the doubt: the catalog lags new releases and an external provider isn't in it
 * at all, so a false "unsupported" would be worse than the provider's own error.
 */
export async function modelSupportsStructuredOutputs(model: string): Promise<boolean> {
  try {
    const found = (await listModels()).find((m) => m.id === model);
    return found ? found.supportsStructuredOutputs : true;
  } catch {
    return true;
  }
}
