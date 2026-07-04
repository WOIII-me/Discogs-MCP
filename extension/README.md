# Discogs Copilot — Chrome extension (MVP)

A Chrome **side panel** that shows pressing intelligence for whatever Discogs.com
page is in the active tab: verdict + score for the pressing you're viewing, the
album's best pressing on a sonic / collector / value axis, taste-fit against your
collection, owned/wanted badges, and an evidence dossier — powered by the
[Discogs MCP](../README.md) Worker's REST API. Read-only.

## Install (load unpacked)

Requires **Chrome 114+** (the side panel API).

1. Clone this repo (or download it) and note the `extension/` folder.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.
4. Click the extension's **Details → Extension options** (or the ◎ toolbar icon →
   settings gear) to open settings.
5. Paste a Discogs **personal access token** — generate one at
   [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
   ("Generate new token") — and hit **Test connection**.
6. Open any Discogs release page and click the ◎ toolbar icon to toggle the panel.

## What it does

| Page | Panel behavior |
|---|---|
| `discogs.com/release/…` and `discogs.com/sell/release/…` | Auto-analyzes: verdict, score, evidence coverage, best pressing of the album, taste fit, owned/wanted, dossier (matrix, engineer, plant, signals, caveats) |
| `discogs.com/master/…` | Top-3 best pressings of the album on the chosen axis |
| `discogs.com/sell/item/…` | Button-triggered analysis of the listed pressing (so browsing doesn't burn your rate budget) |
| anything else | Empty state; collection/wantlist pages note the v0.2 plans |

The **sonic / collector / value** segmented control re-scores on a different axis
(cached, so toggling is instant after the first load).

**First-load honesty:** the first analysis of an album is slow (~10–20 s) — the
server surveys up to 16 pressings against your own Discogs rate budget (60
req/min). Repeats are near-instant thanks to the server's cache. The panel says
so instead of pretending to be broken.

## Notes

- **Your token is stored in plain text** in `chrome.storage.local` (MV3 has no
  secret store). It grants read access to your own Discogs data; revoke it any
  time at discogs.com/settings/developers.
- The panel follows the active tab; theme follows the OS (`prefers-color-scheme`).
- Self-hosting the Worker? Point **Server URL** in settings at your instance.
- UI dev without Chrome: open `sidepanel.html?demo=release` (also `master`,
  `listing`, `setup`, `empty`, `v02`, `ratelimited`, `loading`) in any browser —
  it renders bundled fixtures.
- Fonts: [Geist](https://vercel.com/font) (SIL OFL 1.1, see `fonts/OFL.txt`).
