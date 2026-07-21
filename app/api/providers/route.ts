import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import {
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  updateProvider,
} from "@/lib/db";
import { providerConfig, testProvider } from "@/lib/providers";

const KINDS = ["azure", "bedrock", "google", "custom"] as const;

const mask = (p: Awaited<ReturnType<typeof listProviders>>[number]) => {
  const cfg = providerConfig(p);
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    enabled: p.enabled,
    endpoint: cfg.endpoint ?? null,
    region: cfg.region ?? null,
    apiVersion: cfg.apiVersion ?? null,
    models: cfg.models ?? [],
    promptPrice: cfg.promptPrice ?? null,
    completionPrice: cfg.completionPrice ?? null,
    hasApiKey: Boolean(cfg.apiKey),
  };
};

export async function GET() {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  return Response.json((await listProviders(userId)).map(mask));
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  if (!KINDS.includes(body.kind)) {
    return Response.json({ error: "kind must be azure|bedrock|google|custom" }, { status: 400 });
  }
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
  const models = String(body.models ?? "")
    .split(/[,\n]/)
    .map((m: string) => m.trim())
    .filter(Boolean);
  if (models.length === 0) {
    return Response.json({ error: "List at least one model/deployment name" }, { status: 400 });
  }
  if ((body.kind === "azure" || body.kind === "custom") && !body.endpoint?.trim()) {
    return Response.json({ error: "endpoint is required for this provider" }, { status: 400 });
  }
  const record = await createProvider(
    {
      kind: body.kind,
      name: body.name.trim().slice(0, 60),
      config: {
        apiKey: body.apiKey?.trim() || undefined,
        endpoint: body.endpoint?.trim() || undefined,
        apiVersion: body.apiVersion?.trim() || undefined,
        region: body.region?.trim() || undefined,
        // Bedrock IAM credentials (SigV4).
        accessKeyId: body.accessKeyId?.trim() || undefined,
        secretAccessKey: body.secretAccessKey?.trim() || undefined,
        sessionToken: body.sessionToken?.trim() || undefined,
        models,
        promptPrice: Number(body.promptPrice) || undefined,
        completionPrice: Number(body.completionPrice) || undefined,
      },
    },
    userId
  );
  return Response.json(mask(record), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const body = await req.json();
  const record = await getProvider(body.id);
  if (!record || record.user_id !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (body.action === "test") {
    return Response.json(await testProvider(record));
  }
  if (typeof body.enabled === "boolean") {
    await updateProvider(record.id, { enabled: body.enabled ? 1 : 0 });
  }
  if (typeof body.models === "string") {
    const cfg = providerConfig(record);
    cfg.models = body.models
      .split(/[,\n]/)
      .map((m: string) => m.trim())
      .filter(Boolean);
    await updateProvider(record.id, { config: JSON.stringify(cfg) });
  }
  return Response.json(mask((await getProvider(record.id))!));
}

export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const record = await getProvider(id);
  if (record && record.user_id === userId) await deleteProvider(id);
  return Response.json({ ok: true });
}
