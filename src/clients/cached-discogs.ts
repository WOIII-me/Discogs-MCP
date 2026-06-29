import { DiscogsClient, type DiscogsAuth } from "./discogs.js";
import type * as T from "./types.js";

export interface CacheTTLs {
  release: number; // seconds
  master: number;
  versions: number;
  search: number;
  collection: number;
  wantlist: number;
  profile: number;
}

const DEFAULT_TTLS: CacheTTLs = {
  release: 86400, // 24h
  master: 86400, // 24h
  versions: 43200, // 12h
  search: 21600, // 6h
  collection: 14400, // 4h
  wantlist: 14400, // 4h
  profile: 86400, // 24h
};

function paramsKey(options?: Record<string, unknown>): string {
  if (!options) return "";
  const entries = Object.entries(options)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export class CachedDiscogsClient extends DiscogsClient {
  constructor(
    auth: DiscogsAuth,
    private kv: KVNamespace,
    private ttls: CacheTTLs = DEFAULT_TTLS
  ) {
    super(auth);
  }

  /** Read-through cache. Also used by higher-level helpers for derived aggregates. */
  async withCache<R>(key: string, ttl: number, fetcher: () => Promise<R>): Promise<R> {
    const cached = await this.kv.get(key, "json");
    if (cached !== null) return cached as R;
    const data = await fetcher();
    await this.kv.put(key, JSON.stringify(data), { expirationTtl: Math.max(ttl, 60) });
    return data;
  }

  get cacheTtls(): CacheTTLs {
    return this.ttls;
  }

  override async search(
    query: string,
    options?: Parameters<DiscogsClient["search"]>[1]
  ): Promise<T.DiscogsSearchResponse> {
    const key = `search:${query}:${paramsKey(options)}`;
    return this.withCache(key, this.ttls.search, () => super.search(query, options));
  }

  override async getRelease(id: number): Promise<T.DiscogsRelease> {
    return this.withCache(`release:${id}`, this.ttls.release, () => super.getRelease(id));
  }

  override async getMaster(id: number): Promise<T.DiscogsMaster> {
    return this.withCache(`master:${id}`, this.ttls.master, () => super.getMaster(id));
  }

  override async getMasterVersions(
    id: number,
    options?: Parameters<DiscogsClient["getMasterVersions"]>[1]
  ): Promise<T.DiscogsMasterVersionsResponse> {
    const key = `versions:${id}:${paramsKey(options)}`;
    return this.withCache(key, this.ttls.versions, () => super.getMasterVersions(id, options));
  }

  override async getUserProfile(username: string): Promise<T.DiscogsUserProfile> {
    return this.withCache(`profile:${username}`, this.ttls.profile, () =>
      super.getUserProfile(username)
    );
  }

  override async getCollection(
    username: string,
    options?: Parameters<DiscogsClient["getCollection"]>[1]
  ): Promise<T.DiscogsCollectionResponse> {
    const key = `collection:${username}:${paramsKey(options)}`;
    return this.withCache(key, this.ttls.collection, () => super.getCollection(username, options));
  }

  override async getWantlist(
    username: string,
    options?: Parameters<DiscogsClient["getWantlist"]>[1]
  ): Promise<T.DiscogsWantlistResponse> {
    const key = `wants:${username}:${paramsKey(options)}`;
    return this.withCache(key, this.ttls.wantlist, () => super.getWantlist(username, options));
  }
}
