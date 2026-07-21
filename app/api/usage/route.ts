import { usageStats } from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json(await usageStats(userId));
}
