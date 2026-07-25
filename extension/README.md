# Discogs Copilot — Chrome extension

A Chrome **side panel** that shows pressing intelligence for whatever Discogs.com
page is in the active tab: verdict + score for the pressing you're viewing, the
album's best pressing on a sonic / collector / value axis, taste-fit against your
collection, owned/wanted badges, and an evidence dossier — plus a logged-in home
screen ("Your shelf") with taste profile and what-to-spin-tonight picks. Powered
by the [Discogs MCP](../README.md) Worker's REST API. Read-only.

## Install (load unpacked)

Requires **Chrome 114+** (the side panel API). Not on the Chrome Web Store yet, so
installation is **load unpacked** either way — Chrome will show a developer-mode
notice, and the extension does not auto-update.

**A. Download the zip** (easiest)

1. Open the [latest `ext-v*` release](https://github.com/WOIII-me/Discogs-MCP/releases?q=ext-v)
   and, under **Assets**, download `discogs-copilot-<version>.zip`.
   ⚠️ **Not** *Source code (zip)* — see [Troubleshooting](#troubleshooting).
2. Unzip it. The folder must contain `manifest.json` directly.
3. Open `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder.

**B. Clone the repo** (for development — lets you `git pull` to update)

1. Clone this repo, then `chrome://extensions` → **Developer mode** →
   **Load unpacked**.
2. Pick the **`extension/` subfolder** — not the repo root, which has no
   `manifest.json`.

**Then, either way**

- Open any Discogs release page, click the ◎ toolbar icon to open the panel, and
  hit **Sign in with Discogs** — approve access on discogs.com and you're done.
- Alternative (self-hosters/dev): in the extension options, expand **Advanced**
  and paste a Discogs **personal access token** — generate one at
  [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
  ("Generate new token") — then hit **Test connection**.

### Updating

- **Zip install:** unzip the new `discogs-copilot-<version>.zip` **over the same
  folder** you loaded, then hit **Reload (↻)** in `chrome://extensions`. Keep the
  folder path — removing the extension entry clears its `chrome.storage.local`, so
  you'd have to sign in again.
- **Clone install:** `git pull`, then hit **Reload (↻)** in `chrome://extensions`.

## Troubleshooting

**"Manifest file is missing or unreadable. Could not load manifest."**

Chrome was pointed at a folder with no `manifest.json` at its top level. Almost
always this means *Source code (zip)* was downloaded instead of the release asset:
that archive is the **whole repository**, so the manifest sits one level down in
`extension/`. Fix it by using the `discogs-copilot-<version>.zip` under a release's
**Assets** (path A above), or by picking the `extension/` subfolder if you cloned
(path B).

**Panel is empty / "sign in" does nothing** — check the **Server URL** in the
extension options; the default is the hosted Worker. Reload the extension after
changing it.

## How sign-in works

Discogs only offers OAuth 1.0a, whose consumer secret can't ship inside a public
extension — so the extension signs in **through the Worker**, which already runs
an OAuth 2.1 ⇄ Discogs 1.0a bridge for MCP clients. The extension is a public
OAuth client (authorization code + PKCE): it registers itself at `/register` on
first sign-in, opens the Discogs consent page via `chrome.identity`, and
exchanges the code at `/token`. Your Discogs credentials stay **server-side**,
encrypted inside the OAuth grant; this device only stores the Worker-issued
access/refresh tokens, which you can revoke by signing out (and on the Discogs
side under Settings → Applications).

## What it does

| Page | Panel behavior |
|---|---|
| `discogs.com/release/…` and `discogs.com/sell/release/…` | Auto-analyzes **progressively**: the viewed pressing's verdict renders near-instantly (≤1 Discogs call), then the album survey (best pressing) fills in once the page stays open a moment — so quick browsing never burns your rate budget. During a Discogs cooldown the verdict stays usable with a countdown + manual "Analyze best pressings" |
| `discogs.com/master/…` | Top-3 best pressings of the album on the chosen axis |
| `discogs.com/shop/item/…` (and legacy `/sell/item/…`) | Button-triggered analysis of the listed pressing (so browsing doesn't burn your rate budget) |
| anything else, signed in | **"Your shelf" home screen** — taste profile (dominant styles/genres/decades, top labels, format split), collection/wantlist counts, "what to spin tonight" mood picks from your own records, recently analyzed, recently added |
| anything else, signed out | Empty state |

The home screen is served entirely from the server's cached collection aggregates —
opening the panel never burns your Discogs rate budget. Mood picks re-roll on every
tap of the same chip.

The **sonic / collector / value** segmented control re-scores on a different axis
(cached, so toggling is instant after the first load).

**First-load honesty:** the first analysis of an album is slow (~10–20 s) — the
server surveys up to 16 pressings against your own Discogs rate budget (60
req/min). Repeats are near-instant thanks to the server's cache. The panel says
so instead of pretending to be broken.

## Notes

- **Tokens are stored in plain text** in `chrome.storage.local` (MV3 has no
  secret store). With sign-in that's a revocable Worker-issued session token —
  never a raw Discogs credential; with the Advanced PAT path it's the token you
  pasted (revoke any time at discogs.com/settings/developers).
- `manifest.json` pins a `key` so the unpacked dev extension always gets the same
  ID (stable `https://<id>.chromiumapp.org` OAuth redirect). Remove the `key`
  field when packaging for the Chrome Web Store — the store assigns its own.
- The panel follows the active tab; theme follows the OS (`prefers-color-scheme`).
- Self-hosting the Worker? Point **Server URL** in settings at your instance.
- Results persist across browser restarts (`chrome.storage.local`, fresh 24 h,
  scoped by server + account); when the server is rate-limited, a saved result
  is shown labeled as such instead of a blocking error.
- UI dev without Chrome: open `sidepanel.html?demo=release` (also `master`,
  `listing`, `setup`, `empty`, `v02`, `home`, `deferred`, `ratelimited`,
  `loading`) in any browser — it renders bundled fixtures.
- Fonts: [Geist](https://vercel.com/font) (SIL OFL 1.1, see `fonts/OFL.txt`).
