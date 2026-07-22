// Web Push delivery. Shared verbatim between local and cloud codebases —
// every db call is awaited (harmless on the sync sqlite build).
import webpush from "web-push";
import { deletePushSubscription, listPushSubscriptions } from "./db";

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open when the notification is tapped (e.g. /c/<id>). */
  url?: string;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Send a notification to every device the user has enabled push on.
 * Fire-and-forget semantics: failures are logged, dead subscriptions
 * (410/404 from the push service) are pruned, nothing throws.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  if (!pushConfigured()) return;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@liberde.app",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  } catch (e) {
    // Bad VAPID config must never break the actual response — just skip push.
    console.error("[push] invalid VAPID config, skipping:", String(e).slice(0, 150));
    return;
  }
  let subs;
  try {
    subs = await listPushSubscriptions(userId);
  } catch {
    return;
  }
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify(payload));
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Subscription expired or was revoked — stop trying.
        try {
          await deletePushSubscription(sub.endpoint);
        } catch {}
      } else {
        console.error(`[push] send failed (${status ?? "?"}):`, String(e).slice(0, 200));
      }
    }
  }
}
