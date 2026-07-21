import { NextRequest } from "next/server";
import { addMessage, createConversation, getArtifactByShareId } from "@/lib/db";
import { processAssistantArtifacts } from "@/lib/artifacts";
import { getSettings } from "@/lib/openrouter";
import { getRequestUserId, unauthorized } from "@/lib/auth";

type Params = { params: Promise<{ shareId: string }> };

/**
 * Remix a shared artifact: start a fresh conversation seeded with the artifact,
 * fully independent of the original (like Claude's "Remix this Artifact").
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { shareId } = await params;
  const shared = await getArtifactByShareId(shareId);
  if (!shared || !shared.resolved) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const conv = await createConversation((await getSettings(userId)).defaultModel, null, false, userId);
  const attrs = [
    `identifier="${shared.identifier}"`,
    `command="create"`,
    `type="${shared.type}"`,
    `title="${shared.title.replaceAll('"', "'")}"`,
    ...(shared.language ? [`language="${shared.language}"`] : []),
  ].join(" ");
  const seeded = await addMessage(
    conv.id,
    "assistant",
    `Here's the artifact you're remixing — tell me what you'd like to change.\n\n<liberdeArtifact ${attrs}>\n${shared.resolved.content}\n</liberdeArtifact>`,
    null
  );
  await processAssistantArtifacts(conv.id, seeded.id, seeded.content);
  return Response.json({ conversationId: conv.id }, { status: 201 });
}
