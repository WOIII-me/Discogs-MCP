// Discogs Copilot — content script, loaded ONLY on /sell/item/* pages.
// Single job: resolve which release a marketplace listing is for, by finding
// the listing's link back to its release page. This is the extension's one
// DOM dependency on Discogs markup.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "resolveListing") return false;

  for (const a of document.querySelectorAll('a[href*="/release/"]')) {
    const m = a.getAttribute("href").match(/\/release\/(\d+)/);
    if (m) {
      sendResponse({ releaseId: Number(m[1]) });
      return false;
    }
  }
  sendResponse({ unresolved: true });
  return false;
});
