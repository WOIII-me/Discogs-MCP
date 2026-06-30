import type { Env } from "../types/env.js";
import { getIdentityWithToken } from "../auth/discogs-oauth.js";
import { isAllowedUser } from "../auth/allowlist.js";
import { CachedDiscogsClient } from "../clients/cached-discogs.js";
import { RateLimitError } from "../clients/discogs.js";
import {
  comparePressings,
  findBestPressing,
  getReleaseVersions,
  type CoreContext,
  type CoreResult,
} from "../core/pressings.js";
import { analyzeRelease, analyzeAlbum } from "../core/lookup.js";
import { tasteFit } from "../core/taste.js";

/**
 * REST API head — a second consumer of the same Worker engine, for the browser
 * extension. Read-only, JSON, authenticated by a Discogs personal access token
 * (`Authorization: Bearer <token>`). Mounted at /api/* by the default handler.
 */

interface CachedIdentity {
  username: string;
  userId: number;
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

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // Health check is unauthenticated so clients can probe connectivity.
  if (url.pathname === "/api/health") {
    return json(request, { ok: true, service: "discogs-mcp", api: "v1" });
  }

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return json(request, { error: "Missing 'Authorization: Bearer <discogs_personal_token>'." }, 401);
  }

  let identity: CachedIdentity;
  try {
    identity = await resolveIdentity(env, token);
  } catch {
    return json(request, { error: "Invalid Discogs token." }, 401);
  }
  if (!isAllowedUser(env, identity.username, identity.userId)) {
    return json(request, { error: `Discogs user '${identity.username}' is not on this server's allowlist.` }, 403);
  }

  const ctx: CoreContext = {
    client: new CachedDiscogsClient({ kind: "token", token }, env.CACHE_KV),
    username: identity.username,
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

    return json(request, { error: "Unknown API route." }, 404);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return json(request, { error: e.message, retryAfter: e.retryAfter }, 429);
    }
    return json(request, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
