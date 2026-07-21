import {
  addArtifactVersion,
  getArtifactByIdentifier,
  getArtifactVersion,
  listArtifacts,
  upsertArtifact,
} from "./db";
import {
  applyReplacements,
  parseArtifactBlocks,
  type ArtifactType,
} from "./artifact-shared";
import type { ToolDef } from "./mcp";

/** Tool that lets the model read its current artifacts back — so it can verify
 *  and edit what it built rather than working blind. */
export const ARTIFACT_READ_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "artifact_read",
    description:
      "Read the current content of an artifact you created in this conversation. Call with an identifier to get that artifact's latest content, or with no arguments to list all artifacts. Use this to verify what you built or before editing it.",
    parameters: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description: "The artifact's kebab-case identifier (omit to list all)",
        },
      },
    },
  },
};

export async function execArtifactRead(
  conversationId: string,
  argsJson: string
): Promise<string> {
  let args: { identifier?: string } = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return "Error: tool arguments were not valid JSON";
  }
  const artifacts = await listArtifacts(conversationId);
  if (artifacts.length === 0)
    return (
      "No artifacts exist yet. IMPORTANT: artifacts are NOT created by any tool — " +
      "there is nothing to read. To create one, stop calling tools and write the " +
      "full <liberdeArtifact identifier=\"…\" command=\"create\" type=\"…\" title=\"…\">…full content…</liberdeArtifact> " +
      "block directly in your reply text now."
    );
  if (!args.identifier) {
    return (
      "Artifacts in this conversation:\n" +
      artifacts.map((a) => `- ${a.identifier} (${a.type}): ${a.title}`).join("\n")
    );
  }
  const artifact = artifacts.find((a) => a.identifier === args.identifier);
  if (!artifact) {
    return `Error: no artifact with identifier "${args.identifier}". Available: ${artifacts.map((a) => a.identifier).join(", ")}`;
  }
  const version = await getArtifactVersion(artifact.id);
  return `# ${artifact.title} (${artifact.type}, v${version?.version ?? 1})\n\n${version?.content ?? "(empty)"}`;
}

/**
 * Parse an assistant message for artifact commands and persist the results.
 * Returns the number of artifact versions written.
 */
export async function processAssistantArtifacts(
  conversationId: string,
  messageId: string,
  text: string
): Promise<number> {
  const blocks = parseArtifactBlocks(text);
  let written = 0;

  for (const block of blocks) {
    const existing = await getArtifactByIdentifier(conversationId, block.identifier);

    if (block.command === "update") {
      if (!existing) continue; // update for an unknown artifact — nothing to patch
      const latest = await getArtifactVersion(existing.id);
      if (!latest) continue;
      const { content, applied } = applyReplacements(latest.content, block.replacements);
      if (applied === 0) continue; // no replacement matched; skip a no-op version
      if (block.title) {
        await upsertArtifact(conversationId, block.identifier, {
          type: existing.type,
          language: existing.language,
          title: block.title,
        });
      }
      await addArtifactVersion(existing.id, content, messageId);
      written++;
      continue;
    }

    // create / rewrite carry full content
    if (!block.content.trim()) continue;
    const type: ArtifactType = block.type ?? existing?.type ?? "code";
    const record = await upsertArtifact(conversationId, block.identifier, {
      type,
      language: block.language ?? existing?.language ?? null,
      title: block.title ?? existing?.title ?? block.identifier,
    });
    const latest = await getArtifactVersion(record.id);
    if (latest && latest.content === block.content) continue; // identical — skip
    await addArtifactVersion(record.id, block.content, messageId);
    written++;
  }

  return written;
}
