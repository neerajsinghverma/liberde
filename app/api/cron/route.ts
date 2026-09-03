import { NextRequest } from "next/server";
import { runSchedulerTick } from "@/lib/scheduler";
import { purgeAudit } from "@/lib/audit";
import { getSetting } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entrypoint: runs due scheduled tasks and resumes orphaned agent
 * runs. On serverless there is no long-lived process, so the in-process
 * scheduler never ticks — this endpoint is what keeps scheduled tasks alive.
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}` when that env var is set.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: on a hosted deployment without a secret, refuse rather than
  // expose an open endpoint that spends the API key / can be used to DoS.
  // (Local single-user installs have no VERCEL env and don't need the secret.)
  if (!secret) {
    if (process.env.VERCEL) {
      return Response.json({ error: "Cron not configured" }, { status: 503 });
    }
  } else if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSchedulerTick();
  // Audit retention. Unset means keep everything: regulated retention runs
  // five to seven years, and quietly deleting an audit trail because nobody
  // configured a policy is the wrong default.
  let auditPurged = 0;
  try {
    const days = Number(await getSetting("audit_retention_days", "global"));
    if (Number.isFinite(days) && days > 0) auditPurged = await purgeAudit(days);
  } catch (e) {
    console.error("[liberde] audit purge failed:", String(e).slice(0, 200));
  }
  return Response.json({ ok: true, ...result, auditPurged });
}
