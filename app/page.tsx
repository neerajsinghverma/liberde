import AppShell from "@/components/AppShell";

export default function Home() {
  return <AppShell initialView={{ kind: "chat", conversationId: null }} />;
}
