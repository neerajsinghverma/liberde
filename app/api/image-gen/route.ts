import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { addMessage, getApiKey, getConversation, listMessages } from "@/lib/db";
import { complete, getSettings, openRouterHeaders, OPENROUTER_BASE } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Generate an image via OpenRouter's Image API and record it in the conversation. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const conversation = await getConversation(body.conversationId);
  if (!conversation || (conversation.user_id && conversation.user_id !== userId)) return Response.json({ error: "Conversation not found" }, { status: 404 });
  if (!(await getApiKey(userId))) {
    return Response.json(
      { error: "No OpenRouter API key configured. Add one in Settings." },
      { status: 400 }
    );
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });

  const model = body.model || (await getSettings(userId)).imageModel;
  if (!model) {
    return Response.json(
      { error: "No image model is set. Choose an image-capable model in Settings → General." },
      { status: 400 }
    );
  }
  await addMessage(conversation.id, "user", prompt);
  const runStart = Date.now();

  // Resolve references to the conversation ("make an image of that") into a
  // self-contained prompt, so Image mode carries context like the other tools.
  const genPrompt = await resolveImagePrompt(prompt, conversation.id, userId);

  const upstream = await fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: await openRouterHeaders(userId),
    body: JSON.stringify({ model, prompt: genPrompt }),
    signal: req.signal,
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json({ error: imageErrorMessage(upstream.status, detail) }, { status: 502 });
  }
  const data = await upstream.json();
  const images: string[] = (data.data ?? [])
    .filter((d: { b64_json?: string }) => d.b64_json)
    .map(
      (d: { b64_json: string; media_type?: string }) =>
        `data:${d.media_type || "image/png"};base64,${d.b64_json}`
    );
  if (images.length === 0) {
    return Response.json(
      {
        error:
          "The image model didn't return an image — it may not support image generation, or the prompt was too vague. Try a clearer, more descriptive prompt, or pick an image-capable model in Settings → General.",
      },
      { status: 502 }
    );
  }

  const saved = await addMessage(
    conversation.id,
    "assistant",
    `Generated image for: "${prompt}"`,
    model,
    null,
    {
      images,
      cost: Number(data.usage?.cost) || null,
      cost_breakdown: Number(data.usage?.cost)
        ? JSON.stringify({ image: Number(data.usage.cost) })
        : null,
      duration_ms: Date.now() - runStart,
    }
  );
  return Response.json({ message: saved }, { status: 201 });
}

// Referential/short prompts get expanded against the conversation; clearly
// self-contained ones are used as-is (no extra model call).
const REFERENTIAL = /\b(that|this|it|above|earlier|previous|the one|same|we (discussed|talked|said)|our|my)\b/i;

async function resolveImagePrompt(
  prompt: string,
  conversationId: string,
  userId: string
): Promise<string> {
  if (prompt.length > 80 && !REFERENTIAL.test(prompt)) return prompt;
  try {
    const history = await listMessages(conversationId);
    const prior = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6, -1) // exclude the just-added prompt
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 800)}`)
      .join("\n");
    if (!prior) return prompt;
    const titleModel = (await getSettings(userId)).titleModel;
    const out = await complete(
      titleModel,
      [
        {
          role: "user",
          content: `Recent conversation:\n${prior}\n\nThe user asked to generate an image: "${prompt}". Write a single, vivid, self-contained image-generation prompt that captures what they want, resolving any references to the conversation. Output ONLY the prompt text, no quotes or preamble.`,
        },
      ],
      { temperature: 0.4, max_tokens: 200 },
      userId
    );
    const cleaned = out.trim().replace(/^["']|["']$/g, "");
    return cleaned || prompt;
  } catch {
    return prompt; // never block image generation on context resolution
  }
}

/** Turn a raw upstream image-API error into a short, actionable message. */
function imageErrorMessage(status: number, detail: string): string {
  const d = detail.toLowerCase();
  if (/no image data|finish_reason|no candidates|"stop"/.test(d)) {
    return "The image model couldn't produce an image for that prompt. Try a clearer, more descriptive prompt — or choose a different image model in Settings → General.";
  }
  if (status === 400 && /model|not.*support|invalid|unsupported/.test(d)) {
    return "That model can't generate images. Pick an image-capable model in Settings → General (e.g. a Gemini image or OpenAI image model).";
  }
  return `Image generation failed (${status}). Try again, or pick a different image model in Settings → General.`;
}
