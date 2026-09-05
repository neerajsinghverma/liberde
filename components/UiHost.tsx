"use client";

import { useEffect, useState } from "react";

interface Toast {
  id: number;
  message: string;
  type: "info" | "error" | "success";
}
interface ConfirmState {
  id: number;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Mounted once (in AppShell). Renders toasts + confirm dialogs so we never use
 *  the browser's native alert/confirm. */
export default function UiHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as Omit<Toast, "id">;
      const id = ++n;
      setToasts((t) => [...t, { id, ...d }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    };
    const onConfirm = (e: Event) => setConfirmState((e as CustomEvent).detail as ConfirmState);
    window.addEventListener("liberde-toast", onToast);
    window.addEventListener("liberde-confirm", onConfirm);
    return () => {
      window.removeEventListener("liberde-toast", onToast);
      window.removeEventListener("liberde-confirm", onConfirm);
    };
  }, []);

  const resolveConfirm = (ok: boolean) => {
    if (confirmState) {
      window.dispatchEvent(
        new CustomEvent("liberde-confirm-result", { detail: { id: confirmState.id, ok } })
      );
    }
    setConfirmState(null);
  };

  // Escape declines the confirmation. It must resolve false, never true: this
  // dialog exists so destructive actions are opt-in, and a stray keypress must
  // not become consent.
  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState]);

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${
              t.type === "error"
                ? "bg-red-600 text-white"
                : t.type === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-ink text-bg"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {confirmState && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) resolveConfirm(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <p className="text-sm leading-relaxed">{confirmState.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => resolveConfirm(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => resolveConfirm(true)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${
                  confirmState.danger === false
                    ? "bg-accent hover:bg-accent-hover"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {confirmState.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
