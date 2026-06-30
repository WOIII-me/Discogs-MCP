import type { Env } from "../types/env.js";

/**
 * Whether a Discogs user may authenticate. Shared by the OAuth flow and the
 * REST API. Empty/unset `ALLOWED_DISCOGS_USERS` allows anyone; otherwise the
 * username or numeric id must be on the comma-separated allowlist.
 */
export function isAllowedUser(env: Env, username: string, userId: number): boolean {
  const raw = env.ALLOWED_DISCOGS_USERS?.trim();
  if (!raw) return true;
  const allowed = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(username.toLowerCase()) || allowed.includes(String(userId));
}
