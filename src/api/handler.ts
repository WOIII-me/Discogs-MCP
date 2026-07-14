import type { DiscogsProps, Env } from "../types/env.js";
import { getIdentityWithToken } from "../auth/discogs-oauth.js";
import { isAllowedUser } from "../auth/allowlist.js";
import { CachedDiscogsClient } from "../clients/cached-discogs.js";
import { RateLimitError, type DiscogsAuth } from "../clients/discogs.js";
import {
  comparePressings,
  findBestPressing,
  getReleaseVersions,
  type CoreContext,
  type CoreResult,
} from "../core/pressings.js";
import { analyzeRelease, analyzeAlbum } from "../core/lookup.js";
import { tasteFit } from "../core/taste.js";
import { shelfProfile, spinPicks } from "../core/shelf.js";

/**
 * REST API head — a second consumer of the same Worker engine, for the browser
 * extension. Read-only, JSON, authenticated by `Authorization: Bearer <token>`
 * where the token is either a Worker-issued OAuth access token (extension
 * sign-in flow; Discogs credentials live encrypted in the grant) or a Discogs
 * personal access token (self-hosters, curl). Mounted at /api/* by the
 * default handler.
 */

interface CachedIdentity {
  username: string;
  userId: number;
}

interface ApiAuth {
  username: string;
  userId: number;
  discogsAuth: DiscogsAuth;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allow = origin.startsWith("chrome-extension://") ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

function mapResult<T>(request: Request, r: CoreResult<T>): Response {
  return r.ok ? json(request, r.data) : json(request, { error: r.error }, 422);
}

/** Resolve + cache the token's Discogs identity (keyed by a hash-free short prefix). */
async function resolveIdentity(env: Env, token: string): Promise<CachedIdentity> {
  const key = `api-identity:${token.slice(0, 12)}`;
  const cached = await env.CACHE_KV.get(key, "json");
  if (cached) return cached as CachedIdentity;
  const id = await getIdentityWithToken(token);
  const value: CachedIdentity = { username: id.username, userId: id.id };
  await env.CACHE_KV.put(key, JSON.stringify(value), { expirationTtl: 86400 });
  return value;
}

/**
 * Resolve the bearer to a Discogs identity + credentials. Worker-issued OAuth
 * tokens (shape `userId:grantId:secret`) are unwrapped locally — the Discogs
 * token+secret arrive decrypted from the grant, zero Discogs calls. Anything
 * else is treated as a Discogs PAT exactly as before. Returns null on an
 * invalid/expired token.
 */
async function authenticate(env: Env, token: string): Promise<ApiAuth | null> {
  // Worker tokens always have exactly three colon-separated parts; Discogs
  // PATs never contain colons. Don't fall through: an expired Worker token
  // retried as a PAT would burn a Discogs call per request just to 401.
  if (token.split(":").length === 3) {
    const summary = env.OAUTH_PROVIDER ? await env.OAUTH_PROVIDER.unwrapToken<DiscogsProps>(token) : null;
    if (!summary?.grant.props?.accessToken) return null;
    const props = summary.grant.props;
    return {
      username: props.username,
      userId: props.userId,
      discogsAuth: {
        kind: "oauth",
        consumerKey: env.DISCOGS_CONSUMER_KEY,
        consumerSecret: env.DISCOGS_CONSUMER_SECRET,
        accessToken: props.accessToken,
        accessTokenSecret: props.accessTokenSecret,
      },
    };
  }

  try {
    const identity = await resolveIdentity(env, token);
    return { ...identity, discogsAuth: { kind: "token", token } };
  } catch (e) {
    // A rate-limited (or briefly failing) Discogs must not read as "bad
    // token" — the extension would bounce a valid user to the setup screen.
    // getIdentityWithToken reports the upstream status in its message.
    if (e instanceof Error && /identity error (429|5\d\d)/.test(e.message)) {
      throw new RateLimitError(60);
    }
    return null;
  }
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // Health check is unauthenticated so clients can probe connectivity.
  if (url.pathname === "/api/health") {
    return json(request, { ok: true, service: "discogs-mcp", api: "v1" });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return json(request, { error: "Missing 'Authorization: Bearer <token>'." }, 401);
  }

  let auth: ApiAuth | null;
  try {
    auth = await authenticate(env, token);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return json(request, { error: e.message, retryAfter: e.retryAfter }, 429);
    }
    throw e;
  }
  if (!auth) {
    return json(request, { error: "Invalid or expired token." }, 401);
  }
  if (!isAllowedUser(env, auth.username, auth.userId)) {
    return json(request, { error: `Discogs user '${auth.username}' is not on this server's allowlist.` }, 403);
  }

  // Zero-Discogs-call identity probe — powers the extension's "connected as"
  // state and its post-sign-in verification.
  if (url.pathname === "/api/whoami") {
    return json(request, { username: auth.username });
  }

  const ctx: CoreContext = {
    client: new CachedDiscogsClient(auth.discogsAuth, env.CACHE_KV),
    username: auth.username,
  };
  const q = url.searchParams;
  const axis = q.get("axis") ?? undefined;
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

  try {
    if (url.pathname === "/api/analyze") {
      const release = num(q.get("release"));
      if (release) return mapResult(request, await analyzeRelease(ctx, release, axis));
      const title = q.get("title");
      if (title) return mapResult(request, await analyzeAlbum(ctx, { artist: q.get("artist") ?? undefined, title }, axis));
      return json(request, { error: "Provide ?release=<id> or ?title=<album>&artist=<artist>." }, 400);
    }

    if (url.pathname === "/api/best-pressing") {
      const masterId = num(q.get("master"));
      const releaseId = num(q.get("release"));
      if (!masterId && !releaseId) {
        return json(request, { error: "Provide ?master=<id> or ?release=<id>." }, 400);
      }
      return mapResult(request, await findBestPressing(ctx, { masterId, releaseId, axis }));
    }

    if (url.pathname === "/api/compare") {
      const ids = (q.get("releases") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
      if (ids.length < 2) return json(request, { error: "Provide ?releases=<id,id[,id]> (2–5)." }, 400);
      return mapResult(request, await comparePressings(ctx, { releaseIds: ids.slice(0, 5), axis }));
    }

    if (url.pathname === "/api/versions") {
      const masterId = num(q.get("master"));
      if (!masterId) return json(request, { error: "Provide ?master=<id>." }, 400);
      return mapResult(
        request,
        await getReleaseVersions(ctx, {
          masterId,
          filterCountry: q.get("country") ?? undefined,
          filterFormat: q.get("format") ?? undefined,
          limit: num(q.get("limit")),
        })
      );
    }

    if (url.pathname === "/api/taste-fit") {
      const releaseId = num(q.get("release"));
      if (!releaseId) return json(request, { error: "Provide ?release=<id>." }, 400);
      const rel = await ctx.client.getRelease(releaseId);
      const fit = await tasteFit(ctx, { genres: rel.genres, styles: rel.styles, year: rel.year });
      return json(request, { releaseId, title: rel.title, ...fit });
    }

    // Home-screen endpoints — served from the KV-cached collection/wantlist
    // aggregates (zero Discogs calls once those are warm).
    if (url.pathname === "/api/profile") {
      return json(request, await shelfProfile(ctx));
    }

    if (url.pathname === "/api/spin") {
      const mood = q.get("mood");
      if (!mood) return json(request, { error: "Provide ?mood=<mood>." }, 400);
      return mapResult(request, await spinPicks(ctx, mood));
    }

    return json(request, { error: "Unknown API route." }, 404);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return json(request, { error: e.message, retryAfter: e.retryAfter }, 429);
    }
    return json(request, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
