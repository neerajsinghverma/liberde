import { NextRequest } from "next/server";
import {
  compactConversation,
  getConversation,
  listMessages,
} from "@/lib/db";
import { complete, getSettings } from "@/lib/openrouter";
import { getRequestUserId, unauthorized } from "@/lib/auth";

const KEEP_RECENT = 6;

/** Summarize older turns into one compact message to reclaim context space. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv || (conv.user_id && conv.user_id !== userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const messages = await listMessages(id);
  if (messages.length <= KEEP_RECENT + 2) {
    return Response.json({ error: "Not enough history to compress yet." }, { status: 400 });
  }

  const older = messages.slice(0, messages.length - KEEP_RECENT);
  const transcript = older
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 4000)}`)
    .join("\n\n");

  const settings = await getSettings(userId);
  let summary: string;
  try {
    summary = await complete(
      settings.plannerModel || settings.titleModel,
      [
        {
          role: "user",
          content: `Summarize this conversation so it can stand in for the full history — preserve decisions, facts, names, preferences, open threads, and any artifact identifiers mentioned. Be thorough but compact.\n\n${transcript}`,
        },
      ],
      { temperature: 0.3, max_tokens: 1200 },
      userId
    );
  } catch (e) {
    return Response.json({ error: `Couldn't summarize: ${e}` }, { status: 502 });
  }

  const folded = await compactConversation(
    id,
    KEEP_RECENT,
    `**Summary of earlier conversation (auto-compressed):**\n\n${summary}`
  );
  return Response.json({ ok: true, folded, messages: await listMessages(id) });
}
