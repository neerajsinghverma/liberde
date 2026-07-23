import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { deletePushSubscription, savePushSubscription } from "@/lib/db";
import { pushConfigured, sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";

/** Public VAPID key + whether push is configured on this deployment. */
export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json({
    enabled: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  });
}

/** Register this browser's push subscription for the signed-in user — or,
 *  with { action: "test" }, fire a test notification at every registered
 *  device so delivery can be verified in one click. */
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => null);
  if (body?.action === "test") {
    await sendPushToUser(userId, {
      title: "Liberde",
      body: "Test notification — push is working on this device 🎉",
      url: "/",
    });
    return Response.json({ ok: true });
  }
  if (!body?.endpoint || typeof body.endpoint !== "string") {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  await savePushSubscription(body, userId);
  return Response.json({ ok: true });
}

/** Remove a subscription (notifications toggled off on this device). */
export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return Response.json({ error: "endpoint required" }, { status: 400 });
  await deletePushSubscription(endpoint, userId);
  return Response.json({ ok: true });
}
