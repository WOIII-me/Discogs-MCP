import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env, DiscogsProps } from "../types/env.js";
import {
  AUTHORIZE_URL,
  DiscogsOAuthError,
  getAccessToken,
  getIdentity,
  getRequestToken,
} from "./discogs-oauth.js";
import { isAllowedUser } from "./allowlist.js";
import { markLoginThrottled } from "./login-throttle.js";
import { handleApi } from "../api/handler.js";

const OAUTH_STATE_TTL = 600; // seconds; Discogs request tokens are short-lived anyway

interface PendingAuthState {
  oauthReqInfo: AuthRequest;
  requestTokenSecret: string;
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Discogs MCP</title>
<style>body{font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}</style>
</head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } }
  );
}

/**
 * Default (non-API) handler for the OAuthProvider.
 *
 * Bridges the OAuth 2.1 flow the MCP client speaks to the OAuth 1.0a flow
 * Discogs speaks:
 *   GET /authorize  — parse the MCP client's auth request, get a Discogs
 *                     request token, stash both in KV, redirect to Discogs
 *   GET /callback   — exchange the verifier for a permanent access token,
 *                     resolve identity, complete the MCP authorization with
 *                     the Discogs credentials embedded as props
 */
export const DiscogsAuthHandler: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      // Never surface a blank Cloudflare 1101 to the user — log the stack and
      // show the actual error so OAuth failures are debuggable.
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("DiscogsAuthHandler error:", err.stack ?? err.message);
      return html(
        `<h1>Something went wrong</h1><p>${err.message}</p>` +
          `<p>If this persists, retry the login from your MCP client.</p>`,
        500
      );
    }
  },
};

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // REST API head for the browser extension (Worker-issued OAuth tokens or
    // Discogs PATs — see src/api/handler.ts). OAuthProvider only claims
    // /mcp + /sse, so /api/* reaches this default handler, where
    // env.OAUTH_PROVIDER lets it unwrap Worker tokens itself.
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    if (url.pathname === "/authorize") {
      let oauthReqInfo: AuthRequest;
      try {
        oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (e) {
        return html(`<h1>Invalid authorization request</h1><p>${String(e)}</p>`, 400);
      }
      if (!oauthReqInfo.clientId) {
        return html("<h1>Invalid authorization request</h1><p>Missing client_id.</p>", 400);
      }

      const callbackUrl = `${url.origin}/callback`;
      let requestToken;
      try {
        requestToken = await getRequestToken(
          env.DISCOGS_CONSUMER_KEY,
          env.DISCOGS_CONSUMER_SECRET,
          callbackUrl
        );
      } catch (e) {
        // Discogs rate-limits its OAuth endpoints per source IP, and ours is
        // Cloudflare egress shared with every other Discogs app on Workers.
        // getRequestToken already retried with backoff; a 429 here is sticky.
        // Answer 503 + Retry-After (not a generic 500) and flag it so
        // /api/health can tell clients what is actually going on.
        if (e instanceof DiscogsOAuthError && e.isRateLimited) {
          const retryAfter = await markLoginThrottled(env, e.retryAfter ?? undefined);
          console.warn(`Discogs OAuth request_token rate-limited; login throttled for ${retryAfter}s`);
          return html(
            `<h1>Discogs is throttling logins right now</h1>
<p>Discogs limits how often our server may start a new login, and that limit is shared with
other apps hosted on the same infrastructure. Please try again in about
${Math.ceil(retryAfter / 60)} minute${retryAfter > 90 ? "s" : ""}.</p>
<p>Existing sign-ins and analyses are not affected — only starting a <em>new</em> login is.</p>`,
            503,
            { "Retry-After": String(retryAfter) }
          );
        }
        throw e;
      }

      const state: PendingAuthState = {
        oauthReqInfo,
        requestTokenSecret: requestToken.tokenSecret,
      };
      await env.CACHE_KV.put(`oauth-state:${requestToken.token}`, JSON.stringify(state), {
        expirationTtl: OAUTH_STATE_TTL,
      });

      return Response.redirect(`${AUTHORIZE_URL}?oauth_token=${requestToken.token}`, 302);
    }

    if (url.pathname === "/callback") {
      const oauthToken = url.searchParams.get("oauth_token");
      const verifier = url.searchParams.get("oauth_verifier");
      if (!oauthToken || !verifier) {
        return html("<h1>Authorization failed</h1><p>Missing oauth_token or oauth_verifier.</p>", 400);
      }

      const stateRaw = await env.CACHE_KV.get(`oauth-state:${oauthToken}`);
      if (!stateRaw) {
        return html(
          "<h1>Authorization expired</h1><p>The login attempt expired or was already used. Please retry from your MCP client.</p>",
          400
        );
      }
      const state: PendingAuthState = JSON.parse(stateRaw);
      await env.CACHE_KV.delete(`oauth-state:${oauthToken}`);

      const accessToken = await getAccessToken(
        env.DISCOGS_CONSUMER_KEY,
        env.DISCOGS_CONSUMER_SECRET,
        { token: oauthToken, tokenSecret: state.requestTokenSecret },
        verifier
      );

      const identity = await getIdentity(
        env.DISCOGS_CONSUMER_KEY,
        env.DISCOGS_CONSUMER_SECRET,
        accessToken
      );

      if (!isAllowedUser(env, identity.username, identity.id)) {
        return html(
          `<h1>Access denied</h1><p>Discogs user <strong>${identity.username}</strong> is not on this server's allowlist.</p>`,
          403
        );
      }

      const props: DiscogsProps = {
        username: identity.username,
        userId: identity.id,
        accessToken: accessToken.token,
        accessTokenSecret: accessToken.tokenSecret,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: state.oauthReqInfo,
        userId: identity.username,
        metadata: { discogsUserId: identity.id },
        scope: state.oauthReqInfo.scope ?? [],
        props,
      });

      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/") {
      return html(
        `<h1>Discogs MCP Server</h1>
<p>A Model Context Protocol server for exploring Discogs pressings, collections, and recommendations.</p>
<p>Connect an MCP client (Claude Desktop, Claude Code, …) to <code>${url.origin}/mcp</code> and you will be guided through Discogs login.</p>`
      );
    }

    return new Response("Not found", { status: 404 });
}
