import type { CachedDiscogsClient } from "../clients/cached-discogs.js";
import type { DiscogsBasicInformation } from "../clients/types.js";

/** Compact collection item kept in the KV aggregate and used by all in-memory filtering. */
export interface SlimItem {
  id: number;
  title: string;
  artists: string[];
  year: number;
  genres: string[];
  styles: string[];
  labels: string[];
  formats: string[];
  rating: number;
  dateAdded?: string;
}

export interface FullCollection {
  username: string;
  items: SlimItem[];
  totalItems: number;
  truncated: boolean;
}

const MAX_PAGES = 30; // 30 × 100 = 3,000 items; beyond that we truncate and say so

export function slimItem(
  info: DiscogsBasicInformation,
  rating = 0,
  dateAdded?: string
): SlimItem {
  return {
    id: info.id,
    title: info.title,
    artists: info.artists?.map((a) => a.name) ?? [],
    year: info.year ?? 0,
    genres: info.genres ?? [],
    styles: info.styles ?? [],
    labels: info.labels?.map((l) => l.name) ?? [],
    formats: info.formats?.map((f) => f.name) ?? [],
    rating,
    dateAdded,
  };
}

/**
 * Fetch a user's entire collection as slim items, cached as a single KV
 * aggregate ("fetch once, filter many").
 */
export async function fetchFullCollection(
  client: CachedDiscogsClient,
  username: string
): Promise<FullCollection> {
  return client.withCache(
    `collection-full:${username}`,
    client.cacheTtls.collection,
    async () => {
      const items: SlimItem[] = [];
      let page = 1;
      let totalItems = 0;
      let truncated = false;
      for (;;) {
        const resp = await client.getCollection(username, { page, per_page: 100 });
        totalItems = resp.pagination.items;
        items.push(
          ...resp.releases.map((r) => slimItem(r.basic_information, r.rating, r.date_added))
        );
        if (page >= resp.pagination.pages) break;
        if (page >= MAX_PAGES) {
          truncated = true;
          break;
        }
        page++;
      }
      return { username, items, totalItems, truncated };
    }
  );
}

/** The cached collection aggregate if present — never fetches (summary mode). */
export async function peekFullCollection(
  client: CachedDiscogsClient,
  username: string
): Promise<FullCollection | null> {
  return client.peekCache<FullCollection>(`collection-full:${username}`);
}

/** The cached wantlist aggregate if present — never fetches (summary mode). */
export async function peekFullWantlist(
  client: CachedDiscogsClient,
  username: string
): Promise<FullCollection | null> {
  return client.peekCache<FullCollection>(`wantlist-full:${username}`);
}

/** Fetch a user's entire wantlist as slim items (same aggregate caching). */
export async function fetchFullWantlist(
  client: CachedDiscogsClient,
  username: string
): Promise<FullCollection> {
  return client.withCache(`wantlist-full:${username}`, client.cacheTtls.wantlist, async () => {
    const items: SlimItem[] = [];
    let page = 1;
    let totalItems = 0;
    let truncated = false;
    for (;;) {
      const resp = await client.getWantlist(username, { page, per_page: 100 });
      totalItems = resp.pagination.items;
      items.push(
        ...resp.wants.map((w) => slimItem(w.basic_information, w.rating, w.date_added))
      );
      if (page >= resp.pagination.pages) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        break;
      }
      page++;
    }
    return { username, items, totalItems, truncated };
  });
}

export interface Page<T> {
  totalMatches: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  items: T[];
}

/**
 * Slice a list for a tool response and report pagination metadata so the
 * model knows whether more items exist and how to fetch them.
 */
export function paginate<T>(items: T[], offset = 0, limit = 100): Page<T> {
  const safeOffset = Math.max(0, offset);
  const slice = items.slice(safeOffset, safeOffset + limit);
  return {
    totalMatches: items.length,
    offset: safeOffset,
    returned: slice.length,
    hasMore: safeOffset + slice.length < items.length,
    items: slice,
  };
}

/** Run promise-returning thunks with bounded concurrency, skipping failures. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
  }
  return results;
}
