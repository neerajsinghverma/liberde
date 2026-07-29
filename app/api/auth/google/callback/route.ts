import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  createOAuthUser,
  createSession,
  getUserByEmail,
  countUsers,
  SESSION_COOKIE,
  type User,
} from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth";

/**
 * GET /api/auth/google/callback — finish the OAuth flow.
 * Verifies state, exchanges the code for tokens, reads the verified email from
 * Google, then links to (or creates) a Liberde account and starts a session.
 * All failures redirect back to /login with an error flag rather than leaking.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const origin = req.nextUrl.origin;
  const fail = (reason: string) =>
    Response.redirect(`${origin}/login?oauth_error=${reason}`, 302);

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = jar.get(OAUTH_STATE_COOKIE)?.value;
  // One-shot: clear the state cookie regardless of outcome.
  jar.delete(OAUTH_STATE_COOKIE);

  if (url.searchParams.get("error")) return fail("denied");
  if (!code || !state || !cookieState || state !== cookieState) return fail("state");

  try {
    // 1) Exchange the authorization code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return fail("token");
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail("token");

    // 2) Fetch the verified profile.
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail("profile");
    const info = (await infoRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    const email = info.email?.trim().toLowerCase();
    if (!email || info.email_verified === false) return fail("email");

    // 3) Link to an existing account, or create one (respecting closed signups).
    const existing = await getUserByEmail(email);
    let user: User;
    if (existing) {
      user = existing;
    } else {
      if ((await countUsers()) > 0 && (await getSetting("allow_signups", "global")) === "0") {
        return fail("closed");
      }
      user = await createOAuthUser(email, info.name ?? "");
    }

    // 4) Start a persistent session and land on the app.
    jar.set(SESSION_COOKIE, await createSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return Response.redirect(`${origin}/`, 302);
  } catch (e) {
    console.error("google oauth callback failed:", e);
    return fail("server");
  }
}
