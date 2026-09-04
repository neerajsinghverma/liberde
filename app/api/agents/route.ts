import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createAgent,
  deleteAgent,
  isProjectOwner,
  listAgents,
  updateAgent,
} from "@/lib/db";

/**
 * Agents: a named configuration you start a chat as — a model, standing
 * instructions, and optionally a project whose knowledge it always has.
 *
 * Skills describe *how* to do a task and load on demand; projects hold shared
 * context; an agent is the thing a person picks by name and talks to. Those
 * were three partial slices of the same idea, and this is the one users
 * actually reach for.
 */

const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;
const INSTRUCTIONS_MAX = 20_000;

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await listAgents(userId));
}

/** Shared validation for create and update. Returns an error string or null. */
async function problem(
  body: Record<string, unknown>,
  userId: string,
  requireName: boolean
): Promise<string | null> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (requireName && !name) return "A name is required";
  if (name.length > NAME_MAX) return `Name is too long (max ${NAME_MAX}).`;
  if (typeof body.description === "string" && body.description.length > DESCRIPTION_MAX) {
    return `Description is too long (max ${DESCRIPTION_MAX}).`;
  }
  if (typeof body.instructions === "string" && body.instructions.length > INSTRUCTIONS_MAX) {
    return `Instructions are too long (max ${INSTRUCTIONS_MAX}).`;
  }
  // A project the caller cannot see must not become an agent's knowledge, or
  // binding an agent turns into a way to read someone else's documents.
  if (typeof body.projectId === "string" && body.projectId) {
    if (!(await isProjectOwner(body.projectId, userId))) {
      return "That project does not exist";
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const bad = await problem(body, userId, true);
  if (bad) return Response.json({ error: bad }, { status: 400 });

  const agent = await createAgent(
    {
      name: String(body.name).trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      model: typeof body.model === "string" ? body.model : "",
      instructions: typeof body.instructions === "string" ? body.instructions : "",
      project_id: typeof body.projectId === "string" && body.projectId ? body.projectId : null,
      icon: typeof body.icon === "string" ? body.icon : "sparkles",
    },
    userId
  );
  return Response.json(agent, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const bad = await problem(body, userId, false);
  if (bad) return Response.json({ error: bad }, { status: 400 });

  const fields: Parameters<typeof updateAgent>[2] = {};
  if (typeof body.name === "string") fields.name = body.name.trim();
  if (typeof body.description === "string") fields.description = body.description.trim();
  if (typeof body.model === "string") fields.model = body.model;
  if (typeof body.instructions === "string") fields.instructions = body.instructions;
  if (typeof body.icon === "string") fields.icon = body.icon;
  // Null clears the binding; undefined leaves it alone.
  if (body.projectId === null || typeof body.projectId === "string") {
    fields.project_id = body.projectId || null;
  }

  await updateAgent(id, userId, fields);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deleteAgent(id, userId);
  return Response.json({ ok: true });
}
