// Discogs Copilot — MV3 service worker.
// API client for the Discogs MCP Worker REST head: caching, single-flight,
// error mapping, the /sell/item/* listing → release resolution broker, and
// the "Sign in with Discogs" OAuth client (PKCE against the Worker, which
// bridges to Discogs OAuth 1.0a server-side — no Discogs secret ships here).

const DEFAULT_BASE_URL = "https://discogs-mcp.woiii.workers.dev";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SLACK_MS = 60 * 1000; // refresh this much before expiry

// Toolbar icon toggles the side panel (Claude-in-Chrome behavior). Top-level
// so it also re-applies whenever the worker restarts.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// ---------------------------------------------------------------------------
// Cache: in-memory Map for the worker's lifetime + chrome.storage.session so
// entries survive worker restarts within the browser session.
const memCache = new Map(); // key -> {t, data}
const inFlight = new Map(); // key -> Promise

async function cacheGet(key) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.data;
  try {
    const stored = await chrome.storage.session.get(key);
    const entry = stored[key];
    if (entry && Date.now() - entry.t < CACHE_TTL_MS) {
      memCache.set(key, entry);
      return entry.data;
    }
  } catch {
    // storage.session unavailable — memory cache only
  }
  return null;
}

async function cachePut(key, data) {
  const entry = { t: Date.now(), data };
  memCache.set(key, entry);
  try {
    await chrome.storage.session.set({ [key]: entry });
  } catch {
    // ignore
  }
}

async function getSettings() {
  const { baseUrl, token, oauthTokens, oauthUsername } = await chrome.storage.local.get([
    "baseUrl",
    "token",
    "oauthTokens",
    "oauthUsername",
  ]);
  const normalized = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // OAuth tokens are bound to the server that issued them — a changed server
  // URL means they no longer apply (the PAT, if any, takes over).
  const oauth = oauthTokens && oauthTokens.serverUrl === normalized ? oauthTokens : null;
  return {
    baseUrl: normalized,
    token: token || "",
    oauth,
    username: oauth ? oauthUsername || "" : "",
  };
}

// ---------------------------------------------------------------------------
// OAuth 2.1 client of the Worker (authorization code + PKCE, public client).
// The Worker's /authorize drives the Discogs login; the tokens stored here are
// Worker-issued and revocable — never raw Discogs credentials.

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomB64url(byteLen = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLen)));
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function postToken(baseUrl, params) {
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.error || `Token endpoint HTTP ${res.status}`);
  }
  return body;
}

async function storeTokens(baseUrl, tokenResponse, previous) {
  const oauthTokens = {
    serverUrl: baseUrl,
    clientId: previous?.clientId,
    accessToken: tokenResponse.access_token,
    // The provider rotates refresh tokens; keep the old one if none returned.
    refreshToken: tokenResponse.refresh_token || previous?.refreshToken || "",
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
  };
  await chrome.storage.local.set({ oauthTokens });
  return oauthTokens;
}

/** Register (or reuse) this install as a public OAuth client of the Worker. */
async function ensureClient(baseUrl) {
  const { oauthClient } = await chrome.storage.local.get("oauthClient");
  if (oauthClient?.clientId && oauthClient.serverUrl === baseUrl) return oauthClient.clientId;

  const res = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Discogs Copilot (Chrome extension)",
      client_uri: "https://github.com/WOIII-me/Discogs-MCP",
      redirect_uris: [chrome.identity.getRedirectURL()],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) {
    throw new Error(body.error_description || body.error || `Client registration failed (HTTP ${res.status}).`);
  }
  await chrome.storage.local.set({ oauthClient: { serverUrl: baseUrl, clientId: body.client_id } });
  return body.client_id;
}

/** Interactive sign-in: Discogs consent in a popup, code → tokens, whoami. */
async function handleSignIn() {
  try {
    const { baseUrl } = await getSettings();
    const clientId = await ensureClient(baseUrl);

    const verifier = randomB64url();
    const state = randomB64url(16);
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl =
      `${baseUrl}/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&code_challenge=${b64url(await sha256(verifier))}` +
      `&code_challenge_method=S256`;

    const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    if (!resultUrl) return { error: "Sign-in was cancelled." };
    const params = new URL(resultUrl).searchParams;
    if (params.get("state") !== state) return { error: "Sign-in failed (state mismatch) — please retry." };
    const code = params.get("code");
    if (!code) return { error: params.get("error_description") || params.get("error") || "Sign-in was cancelled." };

    const tokenResponse = await postToken(baseUrl, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    await storeTokens(baseUrl, tokenResponse, { clientId });

    // Resolve the username so the UI can show who's connected (no Discogs call).
    const who = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    });
    const whoBody = await who.json().catch(() => ({}));
    if (!who.ok) {
      await chrome.storage.local.remove(["oauthTokens", "oauthUsername"]);
      return { error: whoBody.error || `Signed in, but the API rejected the session (HTTP ${who.status}).` };
    }
    await chrome.storage.local.set({ oauthUsername: whoBody.username || "" });

    memCache.clear(); // cached verdicts may belong to the previous account
    try { await chrome.storage.session.clear(); } catch { /* ignore */ }
    return { username: whoBody.username };
  } catch (e) {
    // launchWebAuthFlow rejects when the user closes the popup
    const msg = e?.message || String(e);
    return /canceled|cancelled|closed/i.test(msg) ? { error: "Sign-in was cancelled." } : { error: msg };
  }
}

async function handleSignOut() {
  await chrome.storage.local.remove(["oauthTokens", "oauthUsername"]);
  memCache.clear();
  try { await chrome.storage.session.clear(); } catch { /* ignore */ }
  return { ok: true };
}

// Single-flight refresh so parallel 401s don't race each other.
let refreshInFlight = null;

function refreshTokens(baseUrl, oauth) {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const tokenResponse = await postToken(baseUrl, {
          grant_type: "refresh_token",
          refresh_token: oauth.refreshToken,
          client_id: oauth.clientId || (await ensureClient(baseUrl)),
        });
        return await storeTokens(baseUrl, tokenResponse, oauth);
      } catch {
        // Refresh token expired/revoked — drop the session; UI shows setup.
        await chrome.storage.local.remove(["oauthTokens", "oauthUsername"]);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * GET an API path with whatever auth is configured. OAuth session takes
 * precedence over a pasted PAT; expired sessions refresh transparently,
 * including a one-shot retry when the server 401s a token mid-lifetime.
 * Returns {res, body} or {needsSetup} — network errors propagate.
 */
async function apiFetch(path) {
  const { baseUrl, token, oauth } = await getSettings();

  const get = (bearer) =>
    fetch(baseUrl + path, { headers: { Authorization: `Bearer ${bearer}` } });

  if (oauth) {
    let current = oauth;
    if (Date.now() > current.expiresAt - TOKEN_EXPIRY_SLACK_MS) {
      current = await refreshTokens(baseUrl, current);
      if (!current) return token ? { res: await get(token) } : { needsSetup: true };
    }
    let res = await get(current.accessToken);
    if (res.status === 401 && current.refreshToken) {
      current = await refreshTokens(baseUrl, current);
      if (!current) return token ? { res: await get(token) } : { needsSetup: true };
      res = await get(current.accessToken);
    }
    return { res };
  }

  if (!token) return { needsSetup: true };
  return { res: await get(token) };
}

// ---------------------------------------------------------------------------
// Analyze broker. Returns exactly one of:
//   {data}  {needsSetup:true}  {rateLimited:true, retryAfter}  {error}
async function handleAnalyze({ releaseId, masterId, axis }) {
  const { baseUrl, token, oauth } = await getSettings();
  if (!token && !oauth) return { needsSetup: true };

  const ax = axis || "sonic";
  const key = releaseId ? `r${releaseId}:${ax}` : `m${masterId}:${ax}`;

  const cached = await cacheGet(key);
  if (cached) return { data: cached };

  if (inFlight.has(key)) return inFlight.get(key);

  const path = releaseId
    ? `/api/analyze?release=${releaseId}&axis=${ax}`
    : `/api/best-pressing?master=${masterId}&axis=${ax}`;

  const promise = (async () => {
    let res;
    try {
      const out = await apiFetch(path);
      if (out.needsSetup) return { needsSetup: true };
      res = out.res;
    } catch (e) {
      return { error: `Could not reach ${baseUrl} — ${e.message}` };
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body; fall through to status handling
    }

    if (res.status === 401) return { needsSetup: true };
    if (res.status === 429) {
      return { rateLimited: true, retryAfter: body?.retryAfter ?? 60 };
    }
    if (!res.ok) {
      return { error: body?.error || `Server error (HTTP ${res.status}).` };
    }

    await cachePut(key, body);
    return { data: body };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Listing resolution: inject a one-shot resolver into the marketplace-listing
// tab on demand (no persistent content script — this works on tabs that were
// already open before an extension update, and the extension's one DOM
// dependency on Discogs markup stays in this single function).
async function handleResolveListing({ tabId }) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        for (const a of document.querySelectorAll('a[href*="/release/"]')) {
          const m = (a.getAttribute("href") || "").match(/\/release\/(\d+)/);
          if (m) return Number(m[1]);
        }
        return null;
      },
    });
    if (res?.result) return { releaseId: res.result };
  } catch {
    // tab gone, or not scriptable
  }
  return { unresolved: true };
}

// Current auth state for the options page / panel: how (if at all) we're
// connected, and as whom.
async function handleAuthStatus() {
  const { token, oauth, username } = await getSettings();
  if (oauth) return { method: "oauth", username };
  if (token) return { method: "pat" };
  return { method: "none" };
}

// Authenticated identity probe (options "Test connection").
async function handleWhoami() {
  try {
    const out = await apiFetch("/api/whoami");
    if (out.needsSetup) return { needsSetup: true };
    const body = await out.res.json().catch(() => ({}));
    if (!out.res.ok) return { error: body.error || `HTTP ${out.res.status}`, status: out.res.status };
    return { username: body.username };
  } catch (e) {
    return { error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    analyze: handleAnalyze,
    resolveListing: handleResolveListing,
    signIn: handleSignIn,
    signOut: handleSignOut,
    authStatus: handleAuthStatus,
    whoami: handleWhoami,
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse);
  return true;
});
