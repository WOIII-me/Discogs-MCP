import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Token/grant storage for @cloudflare/workers-oauth-provider (binding name must be OAUTH_KV). */
  OAUTH_KV: KVNamespace;
  /** Discogs API response cache + transient OAuth 1.0a request-token state. */
  CACHE_KV: KVNamespace;
  /** Durable Object namespace backing McpAgent sessions. */
  MCP_OBJECT: DurableObjectNamespace;
  DISCOGS_CONSUMER_KEY: string;
  DISCOGS_CONSUMER_SECRET: string;
  /** Optional comma-separated allowlist of Discogs usernames and/or numeric user IDs. */
  ALLOWED_DISCOGS_USERS?: string;
  /**
   * Local-dev only: a Discogs personal access token. When set (only ever in
   * .dev.vars), the dev entry point authenticates every request with it and
   * skips OAuth. Never set this as a production secret.
   */
  DISCOGS_PERSONAL_TOKEN?: string;
  /** Injected by OAuthProvider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * Per-user auth context. The OAuth provider encrypts this into the MCP
 * client's access token and the Agents SDK exposes it as `this.props`
 * on the McpAgent — no separate session KV needed.
 */
export type DiscogsProps = {
  username: string;
  userId: number;
  accessToken: string;
  accessTokenSecret: string;
  [key: string]: unknown;
};
