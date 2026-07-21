import { listModels } from "@/lib/openrouter";
import { listExtModels } from "@/lib/providers";
import { getRequestUserId } from "@/lib/auth";

export async function GET() {
  try {
    const userId = await getRequestUserId();
    const catalog = await listModels();
    const ext = userId ? await listExtModels(userId) : [];
    // External models first so the user's own providers are easy to find.
    return Response.json([...ext, ...catalog]);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
