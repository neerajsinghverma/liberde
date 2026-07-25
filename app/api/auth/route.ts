import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  authForced,
  checkLogin,
  countUsers,
  createSession,
  createUser,
  destroySession,
  getRequestUser,
  getUserByEmail,
  SESSION_COOKIE,
  emailEnabled,
  createAuthToken,
  consumeAuthToken,
  setUserPassword,
  deleteUserSessions,
  setEmailVerified,
} from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { sendPasswordReset, sendVerification } from "@/lib/email";
import { checkBotId } from "botid/server";

/** GET: current auth state. */
export async function GET() {
  const user = await getRequestUser();
  return Response.json({
    authRequired: authForced() || (await countUsers()) > 0,
    hasUsers: (await countUsers()) > 0,
    user: user ? { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin } : null,
  });
}

/**
 * POST: { action: "signup" | "login" | "logout", email?, name?, password? }
 * First signup becomes admin and inherits all pre-account data.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const jar = await cookies();

  if (body.action === "logout") {
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) await destroySession(token);
    jar.delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  }

  // Password-reset REQUEST (email only). Always returns ok — never reveal
  // whether an account exists (no enumeration).
  if (body.action === "forgot") {
    const em = (body.email ?? "").trim().toLowerCase();
    if (em && emailEnabled()) {
      const u = await getUserByEmail(em);
      if (u) {
        try {
          const token = await createAuthToken(u.id, "reset");
          await sendPasswordReset(em, `${req.nextUrl.origin}/reset?token=${token}`);
        } catch (e) {
          console.error("reset email failed:", e);
        }
      }
    }
    return Response.json({ ok: true });
  }

  // Password RESET (token + new password).
  if (body.action === "reset") {
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (password.length < 8) {
      return Response.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    const userId = await consumeAuthToken(token, "reset");
    if (!userId) {
      return Response.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 }
      );
    }
    await setUserPassword(userId, password);
    await deleteUserSessions(userId); // sign out everywhere
    await setEmailVerified(userId); // a working reset link proves email ownership
    return Response.json({ ok: true });
  }

  // Resend a verification email.
  if (body.action === "resend-verification") {
    const em = (body.email ?? "").trim().toLowerCase();
    if (em && emailEnabled()) {
      const u = await getUserByEmail(em);
      if (u && !u.email_verified) {
        try {
          const token = await createAuthToken(u.id, "verify");
          await sendVerification(em, `${req.nextUrl.origin}/api/auth/verify?token=${token}`);
        } catch (e) {
          console.error("verify email failed:", e);
        }
      }
    }
    return Response.json({ ok: true });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "email and password are required" }, { status: 400 });
  }

  if (body.action === "signup") {
    // Vercel BotID: block scripted SIGNUP floods (login brute-force is handled
    // separately by the rate limiter). Fail OPEN — a BotID error/misconfig must
    // never block real signups; only an explicit bot verdict is rejected.
    // (No-op off Vercel / in dev.)
    try {
      const verdict = await checkBotId();
      if (verdict.isBot) {
        return Response.json({ error: "Automated request blocked." }, { status: 403 });
      }
    } catch {
      /* fail open */
    }
    if ((await countUsers()) > 0 && (await getSetting("allow_signups", "global")) === "0") {
      return Response.json({ error: "Signups are disabled" }, { status: 403 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (await getUserByEmail(email)) {
      return Response.json({ error: "An account with that email exists" }, { status: 409 });
    }
    const user = await createUser(email, (body.name ?? "").trim() || email.split("@")[0], password);
    // Email verification: when email is on and this isn't the first (auto-
    // verified admin) account, send a verify link and DON'T sign them in yet.
    if (emailEnabled() && !user.email_verified) {
      try {
        const token = await createAuthToken(user.id, "verify");
        await sendVerification(email, `${req.nextUrl.origin}/api/auth/verify?token=${token}`);
      } catch (e) {
        console.error("verify email failed:", e);
      }
      return Response.json({ ok: true, needsVerification: true }, { status: 201 });
    }
    setSessionCookie(jar, await createSession(user.id), body.remember !== false);
    return Response.json({ ok: true, user: { id: user.id, email, name: user.name } }, { status: 201 });
  }

  // login
  const user = await checkLogin(email, password);
  if (!user) return Response.json({ error: "Invalid email or password" }, { status: 401 });
  if (emailEnabled() && !user.email_verified) {
    return Response.json(
      { error: "Please verify your email first — check your inbox.", needsVerification: true },
      { status: 403 }
    );
  }
  setSessionCookie(jar, await createSession(user.id), body.remember !== false);
  return Response.json({ ok: true, user: { id: user.id, email, name: user.name } });
}

function setSessionCookie(
  jar: Awaited<ReturnType<typeof cookies>>,
  token: string,
  remember: boolean
) {
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Send only over HTTPS in production so the 30-day session token can't leak
    // on a plaintext hop. Left off in local dev (http://localhost).
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // "Stay logged in" → a persistent 30-day cookie. Otherwise a session cookie
    // that the browser clears when it closes (omit maxAge/expires).
    ...(remember ? { maxAge: 30 * 24 * 60 * 60 } : {}),
  });
}
