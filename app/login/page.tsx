"use client";

import { useEffect, useState } from "react";
import { BotIdClient } from "botid/client";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [remember, setRemember] = useState(true);
  const [googleOn, setGoogleOn] = useState(false);
  // When a login/signup needs email verification, we surface a resend option.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setNotice("Email verified — you're all set.");
    } else if (params.get("verify_error") === "1") {
      setError("That verification link is invalid or has expired. Sign in to resend.");
    } else if (params.get("oauth_error")) {
      setError("Google sign-in didn't complete. Please try again.");
    }
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.hasUsers === false) {
          setFirstUser(true);
          setMode("signup");
        }
        setGoogleOn(Boolean(d.googleEnabled));
        if (d.user) window.location.href = "/";
      })
      .catch(() => {});
  }, []);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    clearMessages();
    setUnverifiedEmail(null);
    try {
      if (mode === "forgot") {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "forgot", email }),
        });
        // Always success (no account enumeration).
        setNotice(
          "If an account exists for that email, a password-reset link is on its way. Check your inbox."
        );
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, email, name, password, remember }),
      });
      const data = await res.json();
      if (data.needsVerification) {
        setUnverifiedEmail(email);
        setNotice(
          mode === "signup"
            ? "Account created! Check your email for a verification link to finish signing in."
            : "Please verify your email — check your inbox for the link."
        );
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      window.location.href = "/";
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!unverifiedEmail) return;
    setBusy(true);
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resend-verification", email: unverifiedEmail }),
    }).catch(() => {});
    setBusy(false);
    setNotice("Verification email sent again — check your inbox.");
  };

  const heading = firstUser
    ? "Create the first account — it becomes the admin and inherits everything set up so far."
    : mode === "login"
      ? "Welcome back."
      : mode === "signup"
        ? "Create your account."
        : "We'll email you a reset link.";

  return (
    <div className="relative grid h-dvh place-items-center overflow-hidden px-4">
      {/* Invisible bot detection for signup (active on Vercel). */}
      <BotIdClient protect={[{ path: "/api/auth", method: "POST" }]} />
      <div className="login-blob" style={{ width: 420, height: 420, top: "-12%", left: "-8%", opacity: 0.25 }} />
      <div className="login-blob" style={{ width: 360, height: 360, bottom: "-14%", right: "-6%", opacity: 0.18, animationDelay: "2.5s" }} />
      <div className="login-card relative w-full max-w-sm">
        <div className="login-logo mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent font-display text-4xl font-bold text-white shadow-lg">L</div>
        <h1 className="text-center font-display text-4xl font-semibold tracking-tight">
          Liberde
        </h1>
        <p className="mt-2 text-center text-sm text-ink-muted">{heading}</p>

        {googleOn && mode !== "forgot" && (
          <>
            <a
              href="/api/auth/google"
              className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink/[0.03]"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
              </svg>
              Continue with Google
            </a>
            <div className="my-4 flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form onSubmit={submit} className={googleOn && mode !== "forgot" ? "space-y-3" : "mt-6 space-y-3"}>
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {mode !== "forgot" && (
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          )}
          {mode !== "forgot" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Stay logged in
            </label>
          )}
          {notice && (
            <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{notice}</p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {unverifiedEmail && (
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="text-sm text-accent underline hover:text-accent-hover disabled:opacity-50"
            >
              Resend verification email
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy
              ? "…"
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>

        <div className="mt-3 space-y-1.5 text-center text-sm">
          {mode === "login" && !firstUser && (
            <button
              onClick={() => {
                clearMessages();
                setMode("forgot");
              }}
              className="block w-full text-ink-muted hover:text-ink"
            >
              Forgot password?
            </button>
          )}
          {mode === "forgot" && (
            <button
              onClick={() => {
                clearMessages();
                setMode("login");
              }}
              className="block w-full text-ink-muted hover:text-ink"
            >
              ← Back to sign in
            </button>
          )}
          {!firstUser && mode !== "forgot" && (
            <button
              onClick={() => {
                clearMessages();
                setMode((m) => (m === "login" ? "signup" : "login"));
              }}
              className="block w-full text-ink-muted hover:text-ink"
            >
              {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
