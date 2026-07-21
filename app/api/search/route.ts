import { NextRequest } from "next/server";
import { searchAll } from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

/** Unified search across conversations, projects (incl. files), and artifacts. */
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return Response.json({ conversations: [], projects: [], artifacts: [] });
  return Response.json(await searchAll(q, userId));
}
