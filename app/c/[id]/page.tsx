import AppShell from "@/components/AppShell";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AppShell initialView={{ kind: "chat", conversationId: id }} />;
}
