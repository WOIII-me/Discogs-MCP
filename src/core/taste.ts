import type { CoreContext } from "./pressings.js";
import { fetchFullCollection } from "../utils/collection.js";
import { buildProfile, scoreAffinity, topEntries } from "../utils/similarity-scoring.js";

export interface TasteFit {
  /** 0–100: how well a candidate's genres/styles/decade fit the user's collection. */
  affinity: number;
  collectionSize: number;
  dominantStyles: { name: string; share: number }[];
  dominantGenres: string[];
}

/** How well a candidate (genres/styles/year) fits the user's taste profile. */
export async function tasteFit(
  ctx: CoreContext,
  candidate: { genres?: string[]; styles?: string[]; year?: number }
): Promise<TasteFit> {
  const collection = await fetchFullCollection(ctx.client, ctx.username);
  const profile = buildProfile(collection.items);
  return {
    affinity: scoreAffinity(profile, candidate),
    collectionSize: collection.totalItems,
    dominantStyles: topEntries(profile.styles, 5).map(([name, share]) => ({
      name,
      share: Math.round(share * 1000) / 10,
    })),
    dominantGenres: topEntries(profile.genres, 3).map(([name]) => name),
  };
}
