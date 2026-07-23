import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  addMessage,
  createConversation,
  getArtifact,
  getArtifactVersion,
  getConversation,
  isArtifactSharedWith,
  listArtifactsSharedWith,
  updateConversation,
} from "@/lib/db";
import { processAssistantArtifacts } from "@/lib/artifacts";
import { getSettings } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Artifacts other users shared with me. */
export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listArtifactsSharedWith(userId));
}

/**
 * "Open & edit a copy": clone a shared artifact into a fresh Design-mode
 * conversation owned by the recipient — fully independent of the original
 * (same mechanics as remixing a public share).
 */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const artifactId = String(body.artifactId ?? "");
  if (!(await isArtifactSharedWith(artifactId, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const artifact = await getArtifact(artifactId);
  const latest = artifact ? await getArtifactVersion(artifact.id) : undefined;
  if (!artifact || !latest) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const sourceConv = await getConversation(artifact.conversation_id);
  const ownerId = sourceConv?.user_id;

  const conv = await createConversation(
    (await getSettings(userId)).defaultModel,
    null,
    false,
    userId,
    "design"
  );
  await updateConversation(conv.id, { title: `Copy of ${artifact.title}`.slice(0, 80) });
  const attrs = [
    `identifier="${artifact.identifier}"`,
    `command="create"`,
    `type="${artifact.type}"`,
    `title="${artifact.title.replaceAll('"', "'")}"`,
    ...(artifact.language ? [`language="${artifact.language}"`] : []),
  ].join(" ");
  const seeded = await addMessage(
    conv.id,
    "assistant",
    `Here's your editable copy of the shared design — tell me what you'd like to change.\n\n<liberdeArtifact ${attrs}>\n${latest.content}\n</liberdeArtifact>`,
    null
  );
  await processAssistantArtifacts(conv.id, seeded.id, seeded.content);
  return Response.json(
    { conversationId: conv.id, ownerId: ownerId ?? null },
    { status: 201 }
  );
}
