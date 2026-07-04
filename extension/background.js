// Discogs Copilot — MV3 service worker.
// API client for the Discogs MCP Worker REST head: caching, single-flight,
// error mapping, and the /sell/item/* listing → release resolution broker.

const DEFAULT_BASE_URL = "https://discogs-mcp.woiii.workers.dev";
const CACHE_TTL_MS = 10 * 60 * 1000;

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
  const { baseUrl, token } = await chrome.storage.local.get(["baseUrl", "token"]);
  return {
    baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: token || "",
  };
}

// ---------------------------------------------------------------------------
// Analyze broker. Returns exactly one of:
//   {data}  {needsSetup:true}  {rateLimited:true, retryAfter}  {error}
async function handleAnalyze({ releaseId, masterId, axis }) {
  const { baseUrl, token } = await getSettings();
  if (!token) return { needsSetup: true };

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
      res = await fetch(baseUrl + path, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
// Listing resolution: ask the content script on a /sell/item/* tab which
// release the listing is for.
async function handleResolveListing({ tabId }) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "resolveListing" });
    if (res && res.releaseId) return { releaseId: res.releaseId };
  } catch {
    // no content script on that tab (navigated away, or page not loaded yet)
  }
  return { unresolved: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "analyze") {
    handleAnalyze(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === "resolveListing") {
    handleResolveListing(msg).then(sendResponse);
    return true;
  }
  return false;
});
