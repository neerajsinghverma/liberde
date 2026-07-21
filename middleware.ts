import { NextRequest, NextResponse } from "next/server";

// Show the public marketing page at "/" for logged-out visitors — as a REWRITE
// (not a redirect) so the URL stays a clean "/" with no ".html". Signed-in
// users (any session cookie present) fall through to the app.
//
// Only active where auth is enforced (hosted/Vercel or REQUIRE_AUTH); on a
// single-user local install there are no accounts, so the app shows directly.
const authForced = Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
const SESSION_COOKIE = "liberde_session";

export function middleware(req: NextRequest) {
  if (!authForced) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/landing.html";
  return NextResponse.rewrite(url);
}

// Only intercept the root path.
export const config = { matcher: "/" };
