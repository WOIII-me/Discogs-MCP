import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env, DiscogsProps } from "../types/env.js";
import {
  AUTHORIZE_URL,
  getAccessToken,
  getIdentity,
  getRequestToken,
} from "./discogs-oauth.js";

const OAUTH_STATE_TTL = 600; // seconds; Discogs request tokens are short-lived anyway

interface PendingAuthState {
  oauthReqInfo: AuthRequest;
  requestTokenSecret: string;
}

function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Discogs MCP</title>
<style>body{font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}</style>
</head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function isAllowedUser(env: Env, username: string, userId: number): boolean {
  const raw = env.ALLOWED_DISCOGS_USERS?.trim();
  if (!raw) return true;
  const allowed = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(username.toLowerCase()) || allowed.includes(String(userId));
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
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
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

async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
      const requestToken = await getRequestToken(
        env.DISCOGS_CONSUMER_KEY,
        env.DISCOGS_CONSUMER_SECRET,
        callbackUrl
      );

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
