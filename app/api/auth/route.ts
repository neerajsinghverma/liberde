import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  authForced,
  attemptLogin,
  countUsers,
  createSession,
  createUser,
  destroySession,
  getRequestUser,
  getUserByEmail,
  SESSION_COOKIE,
  emailEnabled,
  googleEnabled,
  createAuthToken,
  consumeAuthToken,
  setUserPassword,
  deleteUserSessions,
  setEmailVerified,
} from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { sendPasswordReset, sendVerification } from "@/lib/email";
import { checkBotId } from "botid/server";
import { rateLimit } from "@/lib/rate-limit";

/** Best-effort client IP for rate-limit keys (Vercel sets x-forwarded-for). */
const clientIp = (req: NextRequest) =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

const tooMany = (retryAfter: number) =>
  Response.json(
    { error: `Too many attempts. Try again in ${retryAfter}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );

/** GET: current auth state. */
export async function GET() {
  const user = await getRequestUser();
  return Response.json({
    authRequired: authForced() || (await countUsers()) > 0,
    hasUsers: (await countUsers()) > 0,
    googleEnabled: googleEnabled(),
    emailEnabled: emailEnabled(),
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: !!user.is_admin,
          emailVerified: !!user.email_verified,
        }
      : null,
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
    // Throttle the unauthenticated email-send path (per IP and per address) so
    // it can't be used to email-bomb someone or run up the Resend bill.
    const ipRl = rateLimit(`email:ip:${clientIp(req)}`, 5, 15 * 60_000);
    if (!ipRl.ok) return tooMany(ipRl.retryAfter);
    if (em) {
      const emRl = rateLimit(`email:addr:${em}`, 3, 60 * 60_000);
      if (!emRl.ok) return tooMany(emRl.retryAfter);
    }
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
    const ipRl = rateLimit(`email:ip:${clientIp(req)}`, 5, 15 * 60_000);
    if (!ipRl.ok) return tooMany(ipRl.retryAfter);
    if (em) {
      const emRl = rateLimit(`email:addr:${em}`, 3, 60 * 60_000);
      if (!emRl.ok) return tooMany(emRl.retryAfter);
    }
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
    // Coarse per-IP throttle in front of account creation + its verify email.
    const sRl = rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000);
    if (!sRl.ok) return tooMany(sRl.retryAfter);
    // Vercel BotID: block scripted SIGNUP floods. Login brute-force is handled
    // by the durable account lockout in attemptLogin(). Fail OPEN — a BotID
    // error/misconfig must never block real signups; only an explicit bot
    // verdict is rejected. (No-op off Vercel / in dev.)
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
    // SOFT verification: send the verify email but log the user straight in
    // (an unverified corporate address whose email got filtered must not be
    // blocked). Verification status is surfaced in Settings, not a login gate.
    if (emailEnabled() && !user.email_verified) {
      try {
        const token = await createAuthToken(user.id, "verify");
        await sendVerification(email, `${req.nextUrl.origin}/api/auth/verify?token=${token}`);
      } catch (e) {
        console.error("verify email failed:", e);
      }
    }
    setSessionCookie(jar, await createSession(user.id), body.remember !== false);
    return Response.json({ ok: true, user: { id: user.id, email, name: user.name } }, { status: 201 });
  }

  // login — no verification gate (soft verification; status shown in Settings).
  // Two-layer brute-force defense: a coarse per-IP burst throttle (in-memory)
  // plus durable per-account lockout after LOGIN_MAX_FAILS failures.
  const loginRl = rateLimit(`login:${clientIp(req)}`, 30, 5 * 60_000);
  if (!loginRl.ok) return tooMany(loginRl.retryAfter);
  const result = await attemptLogin(email, password);
  if (!result.ok) {
    if (result.reason === "locked") {
      const mins = Math.max(1, Math.ceil((result.until - Date.now()) / 60_000));
      return Response.json(
        {
          error: `Too many failed attempts — this account is locked for ${mins} min. Reset your password or ask an admin to unlock it.`,
        },
        { status: 423 }
      );
    }
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  setSessionCookie(jar, await createSession(result.user.id), body.remember !== false);
  return Response.json({ ok: true, user: { id: result.user.id, email, name: result.user.name } });
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
