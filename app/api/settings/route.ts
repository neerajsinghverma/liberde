import { NextRequest } from "next/server";
import { getApiKey, getSetting, setSetting } from "@/lib/db";
import { DEFAULT_EMBEDDING_MODEL } from "@/lib/embeddings";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getSettings } from "@/lib/openrouter";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const s = await getSettings(userId);
  return Response.json({
    hasApiKey: Boolean(await getApiKey(userId)),
    defaultModel: s.defaultModel,
    titleModel: s.titleModel,
    imageModel: s.imageModel,
    transcribeModel: s.transcribeModel,
    plannerModel: s.plannerModel,
    agentExecModel: s.agentExecModel,
    systemPrompt: s.systemPrompt,
    aboutUser: s.aboutUser,
    styleInstructions: s.styleInstructions,
    responseStyle: s.responseStyle,
    memoryEnabled: s.memoryEnabled,
    recallEnabled: s.recallEnabled,
    temperature: s.temperature,
    // The key itself is never returned, only whether one is set — the same
    // contract as the OpenRouter key above.
    hasEmbeddingKey: Boolean((await getSetting("embedding_api_key", userId)) || ""),
    embeddingBaseUrl: (await getSetting("embedding_base_url", userId)) || "",
    embeddingModel:
      (await getSetting("embedding_model", userId)) || DEFAULT_EMBEDDING_MODEL,
  });
}

export async function PUT(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    await setSetting("openrouter_api_key", body.apiKey.trim(), userId);
  }
  if (typeof body.embeddingApiKey === "string") {
    // An empty string is a deliberate clear, which turns semantic retrieval
    // off and falls the app back to lexical scoring.
    await setSetting("embedding_api_key", body.embeddingApiKey.trim(), userId);
  }
  if (typeof body.embeddingBaseUrl === "string")
    await setSetting("embedding_base_url", body.embeddingBaseUrl.trim(), userId);
  if (typeof body.embeddingModel === "string")
    await setSetting("embedding_model", body.embeddingModel.trim(), userId);
  if (typeof body.defaultModel === "string") await setSetting("default_model", body.defaultModel, userId);
  if (typeof body.titleModel === "string") await setSetting("title_model", body.titleModel, userId);
  if (typeof body.imageModel === "string") await setSetting("image_model", body.imageModel, userId);
  if (typeof body.transcribeModel === "string")
    await setSetting("transcribe_model", body.transcribeModel, userId);
  if (typeof body.plannerModel === "string") await setSetting("planner_model", body.plannerModel, userId);
  if (typeof body.agentExecModel === "string")
    await setSetting("agent_exec_model", body.agentExecModel, userId);
  if (typeof body.systemPrompt === "string") await setSetting("system_prompt", body.systemPrompt, userId);
  if (typeof body.aboutUser === "string") await setSetting("about_user", body.aboutUser, userId);
  if (typeof body.styleInstructions === "string")
    await setSetting("style_instructions", body.styleInstructions, userId);
  if (typeof body.responseStyle === "string")
    await setSetting("response_style", body.responseStyle, userId);
  if (typeof body.memoryEnabled === "boolean")
    await setSetting("memory_enabled", body.memoryEnabled ? "1" : "0", userId);
  if (typeof body.recallEnabled === "boolean")
    await setSetting("recall_enabled", body.recallEnabled ? "1" : "0", userId);
  if (body.temperature != null && !Number.isNaN(Number(body.temperature))) {
    await setSetting(
      "temperature",
      String(Math.min(2, Math.max(0, Number(body.temperature)))),
      userId
    );
  }
  return GET();
}
