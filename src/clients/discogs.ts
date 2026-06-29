import { createOAuthClient, getAuthHeader } from "../auth/signing.js";
import type * as T from "./types.js";

const BASE_URL = "https://api.discogs.com";
export const USER_AGENT = "WOIII-Discogs-MCP/1.0.0 +https://github.com/WOIII-me/discogs-mcp";

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(
      `Discogs rate limit hit; retry after ${retryAfter}s. ` +
        `Avoid issuing more requests for a minute.`
    );
  }
}

export class DiscogsApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Discogs API error ${status}: ${body}`);
  }
}

/** Either the full OAuth 1.0a credential set, or a Discogs personal access token. */
export type DiscogsAuth =
  | {
      kind: "oauth";
      consumerKey: string;
      consumerSecret: string;
      accessToken: string;
      accessTokenSecret: string;
    }
  | { kind: "token"; token: string };

export class DiscogsClient {
  private oauth?: ReturnType<typeof createOAuthClient>;
  private token?: { key: string; secret: string };
  private personalToken?: string;

  constructor(auth: DiscogsAuth) {
    if (auth.kind === "token") {
      this.personalToken = auth.token;
    } else {
      this.oauth = createOAuthClient(auth.consumerKey, auth.consumerSecret);
      this.token = { key: auth.accessToken, secret: auth.accessTokenSecret };
    }
  }

  private authHeader(url: string): string {
    if (this.personalToken) return `Discogs token=${this.personalToken}`;
    return getAuthHeader(this.oauth!, url, "GET", this.token);
  }

  protected async request<R>(path: string, params?: Record<string, string>): Promise<R> {
    const url = new URL(path, BASE_URL);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    for (let attempt = 0; ; attempt++) {
      const authHeader = this.authHeader(url.toString());
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: authHeader,
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.discogs.v2.discogs+json",
        },
      });

      if (response.status === 429) {
        const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "60", 10);
        if (attempt >= MAX_RETRIES) throw new RateLimitError(retryAfter);
        // Exponential backoff capped at the server-suggested wait
        await sleep(Math.min(retryAfter, 2 ** attempt) * 1000);
        continue;
      }

      if (!response.ok) {
        throw new DiscogsApiError(response.status, await response.text());
      }

      // Soft-throttle when the per-minute budget is nearly exhausted
      const remaining = Number.parseInt(
        response.headers.get("X-Discogs-Ratelimit-Remaining") ?? "60",
        10
      );
      if (remaining <= 3) await sleep(1500);

      return response.json() as Promise<R>;
    }
  }

  // === Database ===

  async search(
    query: string,
    options?: {
      type?: string;
      format?: string;
      style?: string;
      genre?: string;
      country?: string;
      year?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<T.DiscogsSearchResponse> {
    const params: Record<string, string> = {
      per_page: String(options?.per_page ?? 15),
      page: String(options?.page ?? 1),
    };
    if (query) params.q = query;
    if (options?.type) params.type = options.type;
    if (options?.format) params.format = options.format;
    if (options?.style) params.style = options.style;
    if (options?.genre) params.genre = options.genre;
    if (options?.country) params.country = options.country;
    if (options?.year) params.year = options.year;
    return this.request("/database/search", params);
  }

  async getRelease(id: number): Promise<T.DiscogsRelease> {
    return this.request(`/releases/${id}`);
  }

  async getMaster(id: number): Promise<T.DiscogsMaster> {
    return this.request(`/masters/${id}`);
  }

  async getMasterVersions(
    id: number,
    options?: { page?: number; per_page?: number; sort?: string; sort_order?: string }
  ): Promise<T.DiscogsMasterVersionsResponse> {
    const params: Record<string, string> = {
      per_page: String(options?.per_page ?? 100),
      page: String(options?.page ?? 1),
    };
    if (options?.sort) params.sort = options.sort;
    if (options?.sort_order) params.sort_order = options.sort_order;
    return this.request(`/masters/${id}/versions`, params);
  }

  // === User ===

  async getUserProfile(username: string): Promise<T.DiscogsUserProfile> {
    return this.request(`/users/${encodeURIComponent(username)}`);
  }

  async getCollection(
    username: string,
    options?: { sort?: string; sort_order?: string; per_page?: number; page?: number }
  ): Promise<T.DiscogsCollectionResponse> {
    const params: Record<string, string> = {
      per_page: String(options?.per_page ?? 100),
      page: String(options?.page ?? 1),
    };
    if (options?.sort) params.sort = options.sort;
    if (options?.sort_order) params.sort_order = options.sort_order;
    return this.request(
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases`,
      params
    );
  }

  async getWantlist(
    username: string,
    options?: { per_page?: number; page?: number }
  ): Promise<T.DiscogsWantlistResponse> {
    const params: Record<string, string> = {
      per_page: String(options?.per_page ?? 100),
      page: String(options?.page ?? 1),
    };
    return this.request(`/users/${encodeURIComponent(username)}/wants`, params);
  }
}
