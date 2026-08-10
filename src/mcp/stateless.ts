import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { buildDiscogsServer, makeGetContext } from "./server-factory.js";
import type { DiscogsProps, Env } from "../types/env.js";

type WorkerFetch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

let cachedEnv: Env | undefined;
let cachedHandler: WorkerFetch | undefined;

/**
 * Stateless MCP handler for /mcp (protocol revision 2026-07-28, with built-in
 * legacy serving for 2025-era clients — one endpoint, both eras). No Durable
 * Object session is created; a fresh McpServer is built per request.
 *
 * Auth: the OAuth provider decrypts the bearer token into ctx.props before
 * invoking this handler; agents' wrapper exposes them through
 * getMcpAuthContext() for the duration of the request.
 */
function statelessMcpHandler(env: Env): WorkerFetch {
  // env is stable per isolate in practice; rebuilding on identity change is
  // cheap and keeps this correct if the runtime ever hands out a fresh env.
  if (cachedEnv !== env || !cachedHandler) {
    cachedEnv = env;
    cachedHandler = createMcpHandler(async () => {
      const getContext = await makeGetContext(
        env,
        () => getMcpAuthContext()?.props as DiscogsProps | undefined
      );
      return buildDiscogsServer(getContext);
    }) as unknown as WorkerFetch;
  }
  return cachedHandler;
}

/** ExportedHandler-shaped wrapper for OAuthProvider's apiHandlers map. */
export const StatelessDiscogsMcp = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return statelessMcpHandler(env)(request, env, ctx);
  },
};
