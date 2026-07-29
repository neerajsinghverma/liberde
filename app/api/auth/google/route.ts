import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { googleEnabled } from "@/lib/auth";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth";

/**
 * GET /api/auth/google — begin the Google OAuth 2.0 Authorization Code flow.
 * Mints a random state (stored in a short-lived httpOnly cookie for CSRF
 * protection) and redirects to Google's consent screen. Inert (404) unless
 * GOOGLE_CLIENT_ID/SECRET are configured.
 */
export async function GET(req: NextRequest) {
  if (!googleEnabled()) {
    return Response.json({ error: "Google sign-in is not configured" }, { status: 404 });
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10 minutes — just long enough to complete consent
  });

  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302
  );
}
