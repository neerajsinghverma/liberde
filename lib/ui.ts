"use client";

// In-app replacements for window.alert / window.confirm — dispatched to <UiHost/>.

export type ToastType = "info" | "error" | "success";

export function toast(message: string, type: ToastType = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("liberde-toast", { detail: { message, type } }));
}

/** Ask for browser-notification permission (call from a user gesture). No-ops
 *  after the user has already answered. */
export function ensureNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* unsupported */
  }
}

/** Show a desktop notification when work finishes and the tab is backgrounded,
 *  like Claude. Silent when the tab is focused (the result is already visible). */
export function notifyDone(title: string, body?: string) {
  try {
    if (typeof document === "undefined" || !document.hidden) return;
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "/icon.svg" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } catch {
    /* ignore */
  }
}

let seq = 0;

/** Promise-based confirm dialog. Resolves true if confirmed. */
export function confirmDialog(
  message: string,
  opts?: { confirmLabel?: string; danger?: boolean }
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const id = ++seq;
    const onResult = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.id !== id) return;
      window.removeEventListener("liberde-confirm-result", onResult);
      resolve(Boolean(d.ok));
    };
    window.addEventListener("liberde-confirm-result", onResult);
    window.dispatchEvent(
      new CustomEvent("liberde-confirm", { detail: { id, message, ...opts } })
    );
  });
}
