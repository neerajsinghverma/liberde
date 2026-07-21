// OAuth 2.1 support for remote MCP servers (MCP spec authorization flow):
// discovery + dynamic client registration + PKCE via the SDK, with all state
// persisted per-connector in Postgres. The browser handles the authorization
// redirect; /api/oauth/callback completes the code exchange.
//
// The MCP SDK's OAuthClientProvider interface is synchronous, but our storage
// is now async (Neon). Solution: makeOAuthProvider is async and preloads the
// connector's oauth_data into memory; the provider's methods read/mutate that
// in-memory copy synchronously and persist changes with fire-and-forget writes.

import crypto from "crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getConnectorOAuth, getSetting, saveConnectorOAuth } from "./db";

/** Thrown when a remote server requires the user to authorize in a browser. */
export class AuthorizationRequiredError extends Error {
  constructor(public authUrl: string) {
    super("Authorization required");
    this.name = "AuthorizationRequiredError";
  }
}

export async function oauthBaseUrl(): Promise<string> {
  return (await getSetting("base_url")) || "http://localhost:3000";
}

export interface LiberdeOAuthProvider extends OAuthClientProvider {
  pendingAuthUrl: string | undefined;
}

export async function makeOAuthProvider(
  connectorId: string
): Promise<LiberdeOAuthProvider> {
  // In-memory copy of the connector's oauth_data; kept current by save().
  let data: Record<string, unknown> = await getConnectorOAuth(connectorId);
  const baseUrl = await oauthBaseUrl();

  const save = (patch: Record<string, unknown>) => {
    data = { ...data, ...patch };
    // Persist asynchronously; the merge semantics match the old sync version.
    void saveConnectorOAuth(connectorId, patch).catch((e) =>
      console.error("[liberde] failed to persist connector oauth data:", e)
    );
  };

  const redirectUrl = () => {
    const stored = data.redirect_url as string | undefined;
    return stored ?? `${baseUrl}/api/oauth/callback`;
  };

  const provider: LiberdeOAuthProvider = {
    pendingAuthUrl: undefined,

    get redirectUrl() {
      return redirectUrl();
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "Liberde",
        redirect_uris: [redirectUrl()],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      };
    },

    state(): string {
      const nonce = crypto.randomBytes(16).toString("base64url");
      // Pin the redirect URL at flow start so registration & exchange agree.
      save({
        state_nonce: nonce,
        redirect_url: redirectUrl(),
      });
      return `${connectorId}.${nonce}`;
    },

    clientInformation(): OAuthClientInformation | undefined {
      return data.client_information as OAuthClientInformation | undefined;
    },

    saveClientInformation(info: OAuthClientInformationFull) {
      save({ client_information: info });
    },

    tokens(): OAuthTokens | undefined {
      return data.tokens as OAuthTokens | undefined;
    },

    saveTokens(tokens: OAuthTokens) {
      save({ tokens });
    },

    redirectToAuthorization(url: URL) {
      provider.pendingAuthUrl = url.toString();
      save({ pending_auth_url: url.toString() });
    },

    saveCodeVerifier(verifier: string) {
      save({ code_verifier: verifier });
    },

    codeVerifier(): string {
      const v = data.code_verifier as string | undefined;
      if (!v) throw new Error("No code verifier saved for this connector");
      return v;
    },

    invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
      if (scope === "all") {
        save({
          tokens: undefined,
          client_information: undefined,
          code_verifier: undefined,
        });
      } else if (scope === "tokens") {
        save({ tokens: undefined });
      } else if (scope === "client") {
        save({ client_information: undefined });
      } else {
        save({ code_verifier: undefined });
      }
    },
  };

  return provider;
}

export function parseOAuthState(
  state: string
): { connectorId: string; nonce: string } | null {
  const dot = state.lastIndexOf(".");
  if (dot === -1) return null;
  return { connectorId: state.slice(0, dot), nonce: state.slice(dot + 1) };
}
