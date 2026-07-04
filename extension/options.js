// Discogs Copilot — options page: server base URL + personal access token.

const DEFAULT_BASE_URL = "https://discogs-mcp.woiii.workers.dev";
// A cheap-ish authed probe (Kind of Blue). Also warms the server's collection
// cache, so the first real panel view is faster.
const PROBE_RELEASE = 249504;

const $baseUrl = document.getElementById("baseUrl");
const $token = document.getElementById("token");
const $status = document.getElementById("status");

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = `opt-status ${cls || ""}`;
}

function normalizedBaseUrl() {
  return ($baseUrl.value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function load() {
  const { baseUrl, token } = await chrome.storage.local.get(["baseUrl", "token"]);
  $baseUrl.value = baseUrl || DEFAULT_BASE_URL;
  $token.value = token || "";
}

async function save() {
  const baseUrl = normalizedBaseUrl();
  const token = $token.value.trim();
  await chrome.storage.local.set({ baseUrl, token });

  // Self-hosted Worker: best-effort optional host permission for its origin.
  if (baseUrl !== DEFAULT_BASE_URL) {
    try {
      await chrome.permissions.request({ origins: [new URL(baseUrl).origin + "/*"] });
    } catch {
      // CORS on the Worker still allows extension origins; permission is a nicety
    }
  }
  setStatus("Saved.", "ok");
}

async function testConnection() {
  const baseUrl = normalizedBaseUrl();
  const token = $token.value.trim();

  setStatus("Checking server…");
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    const body = await health.json();
    if (!health.ok || !body.ok) throw new Error(`unexpected reply (HTTP ${health.status})`);
  } catch (e) {
    setStatus(`Server unreachable at ${baseUrl} — ${e.message}`, "err");
    return;
  }

  if (!token) {
    setStatus("Server OK. Paste a token to test authentication.", "err");
    return;
  }

  setStatus("Server OK. Validating token (first run can take a few seconds)…");
  try {
    const res = await fetch(`${baseUrl}/api/taste-fit?release=${PROBE_RELEASE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setStatus("Token rejected — check it was copied completely.", "err");
    } else if (res.status === 403) {
      setStatus(body.error || "This server's allowlist does not include your user.", "err");
    } else if (res.status === 429) {
      setStatus(`Discogs rate limit hit — token looks valid; retry in ~${body.retryAfter ?? 60}s.`, "ok");
    } else if (!res.ok) {
      setStatus(body.error || `Unexpected server reply (HTTP ${res.status}).`, "err");
    } else {
      setStatus(`Connected — token accepted, collection of ${body.collectionSize} records profiled.`, "ok");
    }
  } catch (e) {
    setStatus(`Token check failed — ${e.message}`, "err");
  }
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("test").addEventListener("click", async () => {
  await save();
  await testConnection();
});

load();
