import { createOAuthClient, getAuthHeader } from "./signing.js";
import { USER_AGENT } from "../clients/discogs.js";
import type { DiscogsIdentity } from "../clients/types.js";

const REQUEST_TOKEN_URL = "https://api.discogs.com/oauth/request_token";
const ACCESS_TOKEN_URL = "https://api.discogs.com/oauth/access_token";
const IDENTITY_URL = "https://api.discogs.com/oauth/identity";
export const AUTHORIZE_URL = "https://www.discogs.com/oauth/authorize";

export interface OAuthToken {
  token: string;
  tokenSecret: string;
}

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with retry/backoff for Discogs's unauthenticated rate limit (25/min
 * on the OAuth endpoints) and transient 5xx. Discogs returns 429 with a
 * Retry-After; we honour it (capped) instead of crashing the OAuth flow.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "0", 10);
      const waitMs = Math.min(Math.max(retryAfter, 2 ** attempt), 8) * 1000;
      await sleep(waitMs);
      continue;
    }
    return response;
  }
}

async function postSigned(
  url: string,
  consumerKey: string,
  consumerSecret: string,
  data: Record<string, string>,
  token?: { key: string; secret: string }
): Promise<URLSearchParams> {
  const oauth = createOAuthClient(consumerKey, consumerSecret);
  const authHeader = getAuthHeader(oauth, url, "POST", token, data);

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw new Error(`Discogs OAuth error ${response.status}: ${await response.text()}`);
  }
  return new URLSearchParams(await response.text());
}

/** Step 1: obtain a temporary request token. */
export async function getRequestToken(
  consumerKey: string,
  consumerSecret: string,
  callbackUrl: string
): Promise<OAuthToken> {
  const params = await postSigned(REQUEST_TOKEN_URL, consumerKey, consumerSecret, {
    oauth_callback: callbackUrl,
  });
  const token = params.get("oauth_token");
  const tokenSecret = params.get("oauth_token_secret");
  if (!token || !tokenSecret) {
    throw new Error("Discogs did not return a request token");
  }
  return { token, tokenSecret };
}

/** Step 3: exchange the verified request token for a permanent access token. */
export async function getAccessToken(
  consumerKey: string,
  consumerSecret: string,
  requestToken: OAuthToken,
  verifier: string
): Promise<OAuthToken> {
  const params = await postSigned(
    ACCESS_TOKEN_URL,
    consumerKey,
    consumerSecret,
    { oauth_verifier: verifier },
    { key: requestToken.token, secret: requestToken.tokenSecret }
  );
  const token = params.get("oauth_token");
  const tokenSecret = params.get("oauth_token_secret");
  if (!token || !tokenSecret) {
    throw new Error("Discogs did not return an access token");
  }
  return { token, tokenSecret };
}

/** Resolve the authenticated user's identity. */
export async function getIdentity(
  consumerKey: string,
  consumerSecret: string,
  accessToken: OAuthToken
): Promise<DiscogsIdentity> {
  const oauth = createOAuthClient(consumerKey, consumerSecret);
  const authHeader = getAuthHeader(oauth, IDENTITY_URL, "GET", {
    key: accessToken.token,
    secret: accessToken.tokenSecret,
  });
  const response = await fetchWithRetry(IDENTITY_URL, {
    headers: { Authorization: authHeader, "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Discogs identity error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/** Resolve identity using a Discogs personal access token (local-dev shortcut). */
export async function getIdentityWithToken(token: string): Promise<DiscogsIdentity> {
  const response = await fetch(IDENTITY_URL, {
    headers: { Authorization: `Discogs token=${token}`, "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Discogs identity error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
