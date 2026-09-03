import { NextRequest } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { listAudit, toCef, toJsonl, verifyAuditChain } from "@/lib/audit";

/**
 * Admin view onto the audit trail: read it, prove it hasn't been edited, and
 * hand it to a SIEM.
 *
 * Admin-only, and deliberately not scoped to the caller — an audit log you can
 * only see your own half of answers none of the questions it exists for.
 */

const forbidden = () => Response.json({ error: "Admins only" }, { status: 403 });

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function GET(req: NextRequest) {
  const user = await getRequestUser();
  if (!user?.is_admin) return forbidden();

  const sp = req.nextUrl.searchParams;

  // Verification walks the entire chain, so it is its own request rather than
  // something every page load pays for.
  if (sp.get("verify") === "1") {
    return Response.json(await verifyAuditChain());
  }

  const format = (sp.get("format") || "json").toLowerCase();
  // An export is for archiving, so it takes a far larger page than the UI does.
  const defaultLimit = format === "json" ? 200 : 1000;

  const entries = await listAudit({
    userId: sp.get("userId") || undefined,
    action: sp.get("action") || undefined,
    since: num(sp.get("since")),
    until: num(sp.get("until")),
    limit: num(sp.get("limit")) ?? defaultLimit,
    offset: num(sp.get("offset")),
  });

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "jsonl" || format === "cef") {
    const body = format === "cef" ? toCef(entries) : toJsonl(entries);
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="liberde-audit-${stamp}.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.json({ entries, count: entries.length });
}
