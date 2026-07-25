"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return <p className="text-center text-sm text-red-500">This reset link is missing its token.</p>;
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          Your password has been reset. You&apos;ve been signed out everywhere.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password (min 8 chars)"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <input
        type="password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <div className="relative grid h-dvh place-items-center overflow-hidden px-4">
      <div className="login-blob" style={{ width: 420, height: 420, top: "-12%", left: "-8%", opacity: 0.25 }} />
      <div className="login-blob" style={{ width: 360, height: 360, bottom: "-14%", right: "-6%", opacity: 0.18, animationDelay: "2.5s" }} />
      <div className="login-card relative w-full max-w-sm">
        <div className="login-logo mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent font-display text-4xl font-bold text-white shadow-lg">L</div>
        <h1 className="text-center font-display text-3xl font-semibold tracking-tight">
          Reset password
        </h1>
        <p className="mt-2 text-center text-sm text-ink-muted">Choose a new password.</p>
        <Suspense fallback={<p className="mt-6 text-center text-sm text-ink-muted">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
