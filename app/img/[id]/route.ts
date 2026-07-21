import { NextRequest } from "next/server";
import { getGeneratedImage } from "@/lib/db";

export const runtime = "nodejs";

/** Serve an AI-generated image by id, so designs can embed it by URL instead of
 *  bloating the artifact with a giant data URL. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const img = await getGeneratedImage(id);
  if (!img) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(img.data, "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": img.mime || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
