"use client";

import { useEffect, useState } from "react";
import { BotIdClient } from "botid/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstUser, setFirstUser] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.hasUsers === false) {
          setFirstUser(true);
          setMode("signup");
        }
        if (d.user) window.location.href = "/";
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, email, name, password, remember }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      window.location.href = "/";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid h-dvh place-items-center overflow-hidden px-4">
      {/* Invisible bot detection for signup/login (active on Vercel). */}
      <BotIdClient protect={[{ path: "/api/auth", method: "POST" }]} />
      <div className="login-blob" style={{ width: 420, height: 420, top: "-12%", left: "-8%", opacity: 0.25 }} />
      <div className="login-blob" style={{ width: 360, height: 360, bottom: "-14%", right: "-6%", opacity: 0.18, animationDelay: "2.5s" }} />
      <div className="login-card relative w-full max-w-sm">
        <div className="login-logo mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent font-display text-4xl font-bold text-white shadow-lg">L</div>
        <h1 className="text-center font-display text-4xl font-semibold tracking-tight">
          Liberde
        </h1>
        <p className="mt-2 text-center text-sm text-ink-muted">
          {firstUser
            ? "Create the first account — it becomes the admin and inherits everything set up so far."
            : mode === "login"
              ? "Welcome back."
              : "Create your account."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
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
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Stay logged in
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {!firstUser && (
          <button
            onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
            className="mt-3 w-full text-center text-sm text-ink-muted hover:text-ink"
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
