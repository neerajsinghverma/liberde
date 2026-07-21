import type { Metadata } from "next";
import { getSharedChat } from "@/lib/db";
import SharedChatView from "@/components/SharedChatView";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ shareId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params;
  const shared = await getSharedChat(shareId);
  return { title: shared ? `${shared.title} — Liberde` : "Chat not found — Liberde" };
}

export default async function SharedChatPage({ params }: Params) {
  const { shareId } = await params;
  const shared = await getSharedChat(shareId);

  if (!shared) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-display text-3xl font-semibold">Chat not found</h1>
        <p className="text-ink-muted">This shared link may have been deleted.</p>
      </div>
    );
  }

  return (
    <SharedChatView
      title={shared.title}
      createdAt={shared.created_at}
      messages={JSON.parse(shared.snapshot)}
    />
  );
}
