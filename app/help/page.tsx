import AppShell from "@/components/AppShell";

/**
 * AppShell pushes `/help` when the Help view opens, so the URL has to resolve
 * on its own. Without this file the in-app navigation worked and a reload or a
 * shared link 404'd — the kind of break nobody hits while clicking around and
 * everybody hits eventually.
 */
export default function HelpPage() {
  return <AppShell initialView={{ kind: "help" }} />;
}
