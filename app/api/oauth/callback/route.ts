import { NextRequest } from "next/server";
import { getConnector, getConnectorOAuth, saveConnectorOAuth } from "@/lib/db";
import { finishConnectorAuth } from "@/lib/mcp";
import { parseOAuthState } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

const page = (title: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#faf9f5;color:#1f1e1d}
.card{text-align:center;max-width:26rem;padding:2rem}h1{font-size:1.4rem}</style></head>
<body><div class="card"><h1>${ok ? "✅" : "❌"} ${title}</h1><p>${body}</p></div></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html" } }
  );

/**
 * OAuth redirect target for remote MCP servers.
 * Note: base_url is deliberately NOT updated here — it's only set from
 * user-initiated actions (the Test button), so a crafted callback request
 * can't poison the redirect URI used in future flows.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return page("Authorization failed", `The server reported: ${oauthError}`, false);
  }
  const parsed = state ? parseOAuthState(state) : null;
  if (!code || !parsed) {
    return page("Invalid callback", "Missing code or state parameter.", false);
  }
  const connector = await getConnector(parsed.connectorId);
  if (!connector) {
    return page("Unknown connector", "This connector no longer exists.", false);
  }
  const expectedNonce = (await getConnectorOAuth(connector.id)).state_nonce;
  if (!expectedNonce || expectedNonce !== parsed.nonce) {
    return page("State mismatch", "The authorization state didn't match. Try connecting again.", false);
  }

  try {
    await finishConnectorAuth(connector, code);
    await saveConnectorOAuth(connector.id, { state_nonce: undefined, pending_auth_url: undefined });
    return page(
      `${connector.name} connected`,
      "Authorization complete. You can close this tab and return to Liberde — hit Test on the connector to confirm.",
      true
    );
  } catch (e) {
    return page("Token exchange failed", String(e).slice(0, 300), false);
  }
}
