// Discogs Copilot — options page: Discogs sign-in (primary) + advanced
// self-hosting settings (server base URL, personal access token).

const DEFAULT_BASE_URL = "https://discogs-mcp.woiii.workers.dev";
const IS_EXT = location.protocol === "chrome-extension:";

const $baseUrl = document.getElementById("baseUrl");
const $token = document.getElementById("token");
const $status = document.getElementById("status");
const $signedOut = document.getElementById("account-signedout");
const $signedIn = document.getElementById("account-signedin");
const $username = document.getElementById("account-username");
const $advanced = document.getElementById("advanced");

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = `opt-status ${cls || ""}`;
}

function normalizedBaseUrl() {
  return ($baseUrl.value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function renderAccount(auth) {
  const signedIn = auth.method === "oauth";
  $signedOut.hidden = signedIn;
  $signedIn.hidden = !signedIn;
  if (signedIn) $username.textContent = auth.username || "your Discogs account";
  // Self-hosters/devs on a pasted PAT keep the advanced section in view.
  if (auth.method === "pat") $advanced.open = true;
}

async function refreshAccount() {
  const auth = await chrome.runtime.sendMessage({ type: "authStatus" });
  renderAccount(auth || { method: "none" });
}

async function load() {
  if (!IS_EXT) {
    // Plain-browser preview (UI dev): fixed demo state, no chrome.* APIs.
    $baseUrl.value = DEFAULT_BASE_URL;
    renderAccount({ method: "none" });
    return;
  }
  const { baseUrl, token } = await chrome.storage.local.get(["baseUrl", "token"]);
  $baseUrl.value = baseUrl || DEFAULT_BASE_URL;
  $token.value = token || "";
  await refreshAccount();
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
  await refreshAccount(); // switching servers can invalidate the signed-in state
}

async function signIn() {
  if (!IS_EXT) return setStatus("Demo mode — sign-in runs in the installed extension.", "err");
  setStatus("Opening Discogs sign-in…");
  const res = await chrome.runtime.sendMessage({ type: "signIn" });
  if (res?.username) {
    setStatus(`Connected as ${res.username}.`, "ok");
  } else {
    setStatus(res?.error || "Sign-in failed.", "err");
  }
  await refreshAccount();
}

async function signOut() {
  await chrome.runtime.sendMessage({ type: "signOut" });
  setStatus("Signed out. The session token was discarded from this device.", "ok");
  await refreshAccount();
}

async function testConnection() {
  const baseUrl = normalizedBaseUrl();

  setStatus("Checking server…");
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    const body = await health.json();
    if (!health.ok || !body.ok) throw new Error(`unexpected reply (HTTP ${health.status})`);
  } catch (e) {
    setStatus(`Server unreachable at ${baseUrl} — ${e.message}`, "err");
    return;
  }

  if (!IS_EXT) return setStatus("Server OK. (Demo mode — auth check runs in the installed extension.)", "ok");

  setStatus("Server OK. Checking authentication…");
  const res = await chrome.runtime.sendMessage({ type: "whoami" });
  if (res?.username) {
    setStatus(`Connected as ${res.username}.`, "ok");
  } else if (res?.needsSetup) {
    setStatus("Server OK. Sign in with Discogs (or paste a token under Advanced) to connect.", "err");
  } else if (res?.status === 401) {
    setStatus("Authentication rejected — sign in again, or check the pasted token.", "err");
  } else if (res?.status === 403) {
    setStatus(res.error || "This server's allowlist does not include your user.", "err");
  } else if (res?.status === 429) {
    setStatus("Discogs rate limit hit — auth looks valid; retry in a minute.", "ok");
  } else {
    setStatus(res?.error || "Authentication check failed.", "err");
  }
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("signin").addEventListener("click", signIn);
document.getElementById("signout").addEventListener("click", signOut);
document.getElementById("test").addEventListener("click", async () => {
  if (IS_EXT) await save();
  await testConnection();
});

load();
