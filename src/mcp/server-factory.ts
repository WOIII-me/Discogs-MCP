import { McpServer } from "@modelcontextprotocol/server";
import { CachedDiscogsClient } from "../clients/cached-discogs.js";
import { getIdentityWithToken } from "../auth/discogs-oauth.js";
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/discogs.js";
import type { GetContext } from "./tools/context.js";
import type { DiscogsProps, Env } from "../types/env.js";
import { VERSION } from "../version.js";

/**
 * Local-dev identity, resolved once per isolate from DISCOGS_PERSONAL_TOKEN.
 * The stateless handler builds a server per request, so the identity lookup
 * must not happen per request.
 */
let devIdentityCache: { token: string; username: string; userId: number } | null = null;

async function resolveDevIdentity(token: string): Promise<{ username: string; userId: number }> {
  if (devIdentityCache?.token !== token) {
    const id = await getIdentityWithToken(token);
    devIdentityCache = { token, username: id.username, userId: id.id };
  }
  return { username: devIdentityCache.username, userId: devIdentityCache.userId };
}

/**
 * Builds the per-request tool context resolver shared by every entry point:
 * the stateless /mcp handler, the legacy /sse McpAgent, and the local dev
 * server. `getProps` is called lazily at tool-call time, so it may read
 * request-scoped state (e.g. getMcpAuthContext()).
 */
export async function makeGetContext(
  env: Env,
  getProps: () => DiscogsProps | undefined
): Promise<GetContext> {
  // Local-dev shortcut: when a personal access token is present in the
  // environment (only ever set in .dev.vars), authenticate every request
  // with it and skip OAuth. Never set in production — see types/env.ts.
  const devToken = env.DISCOGS_PERSONAL_TOKEN;
  const devIdentity = devToken ? await resolveDevIdentity(devToken) : null;

  return () => {
    if (devToken && devIdentity) {
      return {
        client: new CachedDiscogsClient({ kind: "token", token: devToken }, env.CACHE_KV),
        username: devIdentity.username,
        userId: devIdentity.userId,
      };
    }

    const props = getProps();
    if (!props?.accessToken) {
      throw new Error("Not authenticated with Discogs — complete the OAuth flow first.");
    }
    return {
      client: new CachedDiscogsClient(
        {
          kind: "oauth",
          consumerKey: env.DISCOGS_CONSUMER_KEY,
          consumerSecret: env.DISCOGS_CONSUMER_SECRET,
          accessToken: props.accessToken,
          accessTokenSecret: props.accessTokenSecret,
        },
        env.CACHE_KV
      ),
      username: props.username,
      userId: props.userId,
    };
  };
}

/**
 * Builds the Discogs MCP server (SDK v2). Called once per request by the
 * stateless /mcp handler — registration is cheap and holds no I/O.
 *
 * cacheHints fill the ttlMs/cacheScope fields the 2026-07-28 revision
 * requires on cacheable results. The tool/prompt/resource catalog only
 * changes on deploy, so clients may cache it for an hour; everything is
 * marked private because responses ride on authenticated requests and
 * shared intermediaries must not cache them. Per-resource hints on reads
 * mirror the server-side KV TTLs in cached-discogs.ts.
 */
export function buildDiscogsServer(getContext: GetContext): McpServer {
  const server = new McpServer(
    { name: "discogs", version: VERSION },
    {
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "private" },
        "prompts/list": { ttlMs: 3_600_000, cacheScope: "private" },
        "resources/list": { ttlMs: 3_600_000, cacheScope: "private" },
        "resources/templates/list": { ttlMs: 3_600_000, cacheScope: "private" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "private" },
      },
    }
  );
  registerAllTools(server, getContext);
  registerPrompts(server);
  registerResources(server, getContext);
  return server;
}
