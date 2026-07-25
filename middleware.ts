import { NextRequest, NextResponse } from "next/server";

// Show the public marketing page at "/" for logged-out visitors — as a REWRITE
// (not a redirect) so the URL stays a clean "/" with no ".html". Signed-in
// users (any session cookie present) fall through to the app.
//
// Only active where auth is enforced (hosted/Vercel or REQUIRE_AUTH); on a
// single-user local install there are no accounts, so the app shows directly.
const authForced = Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
const SESSION_COOKIE = "liberde_session";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Origin check on state-changing /api requests: defends against CSRF and,
  // crucially, blind writes from sandboxed artifact/analysis iframes (which
  // carry the same-site session cookie but send `Origin: null`). Programmatic
  // clients (curl, the /v1 Bearer API, server-to-server) send no Origin and
  // are allowed; same-origin browser requests match the host and are allowed;
  // cross-origin and `null`-origin are rejected. (/v1 is not under /api.)
  if (pathname.startsWith("/api/") && MUTATING.has(req.method) && pathname !== "/api/cron") {
    const origin = req.headers.get("origin");
    if (origin) {
      const host = req.headers.get("host");
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        sameOrigin = false; // e.g. Origin: null → URL() throws
      }
      if (!sameOrigin) {
        return NextResponse.json(
          { error: "Cross-origin request blocked" },
          { status: 403 }
        );
      }
    }
  }

  // Landing-page rewrite for the root path.
  if (pathname === "/") {
    if (!authForced) return NextResponse.next();
    if (req.cookies.get(SESSION_COOKIE)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/landing.html";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
