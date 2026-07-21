import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { OPENROUTER_BASE, openRouterHeaders } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Default audio-capable model. Gemini handles webm/ogg/wav/mp3 well. */
const DEFAULT_TRANSCRIBE_MODEL = "google/gemini-2.5-flash";

/**
 * Speech-to-text via OpenRouter. OpenRouter has no Whisper endpoint, so we send
 * the recorded clip as an `input_audio` content part to a multimodal chat model
 * and ask it to transcribe verbatim. Works in every browser (unlike the
 * built-in Web Speech API) and bills against the user's OpenRouter credits.
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();

  let body: { data?: string; format?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const { data, format } = body;
  if (!data) return Response.json({ error: "No audio provided" }, { status: 400 });

  const model =
    (await getSetting("transcribe_model", userId)) || DEFAULT_TRANSCRIBE_MODEL;

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: await openRouterHeaders(userId),
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe the following audio verbatim. Output only the transcript text with no quotes, labels, or commentary. If there is no discernible speech, output nothing.",
              },
              {
                type: "input_audio",
                input_audio: { data, format: format || "webm" },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json(
        { error: `Transcription failed (${res.status})`, detail },
        { status: 502 }
      );
    }
    const json = await res.json();
    const text: string = (json.choices?.[0]?.message?.content ?? "").trim();
    return Response.json({ text });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Transcription error" },
      { status: 500 }
    );
  }
}
