import type { Metadata } from "next";
import { getArtifactByShareId } from "@/lib/db";
import SharedArtifact from "@/components/SharedArtifact";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ shareId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params;
  const shared = await getArtifactByShareId(shareId);
  return { title: shared ? `${shared.title} — Liberde` : "Artifact not found — Liberde" };
}

export default async function SharedArtifactPage({ params }: Params) {
  const { shareId } = await params;
  const shared = await getArtifactByShareId(shareId);

  if (!shared || !shared.resolved) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-display text-3xl font-semibold">Artifact not found</h1>
        <p className="text-ink-muted">This link may have been unpublished.</p>
      </div>
    );
  }

  return (
    <SharedArtifact
      shareId={shareId}
      title={shared.title}
      type={shared.type}
      language={shared.language}
      content={shared.resolved.content}
      version={shared.resolved.version}
      isLatest={shared.share_mode !== "pinned"}
    />
  );
}
