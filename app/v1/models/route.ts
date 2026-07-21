import { NextRequest } from "next/server";
import { verifyPlatformApiKey } from "@/lib/db";
import { listModels } from "@/lib/openrouter";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!key || !(await verifyPlatformApiKey(key))) {
    return Response.json(
      { error: { message: "Invalid or missing Liberde API key", type: "authentication_error" } },
      { status: 401 }
    );
  }
  try {
    const models = await listModels();
    return Response.json({
      object: "list",
      data: models.map((m) => ({ id: m.id, object: "model", owned_by: "openrouter" })),
    });
  } catch (e) {
    return Response.json({ error: { message: String(e) } }, { status: 502 });
  }
}
