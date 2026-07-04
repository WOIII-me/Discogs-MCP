// Discogs Copilot — side panel controller.
// Tracks the active tab, routes by URL only (never by DOM), renders the
// evidence dossier. Runs standalone for UI dev: open sidepanel.html?demo=release
// (or master / listing / setup / empty / loading / ratelimited) in any browser.

(() => {
  "use strict";

  const IS_EXT = location.protocol === "chrome-extension:";
  const DEMO = !IS_EXT ? new URLSearchParams(location.search).get("demo") : null;
  const DISCOGS = "https://www.discogs.com";

  const $body = document.getElementById("body");
  const $seg = document.getElementById("axis-seg");
  const $sub = document.getElementById("appbar-sub");

  const state = {
    axis: "sonic",
    route: { kind: "empty", reason: "none" },
    tabId: null,
    windowId: null,
    listingReleaseId: null, // resolved release for the current /sell/item tab
    seq: 0, // stale-response guard
    lastKey: null, // last successfully rendered request key
  };

  // ------------------------------------------------------------- utilities
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  function verdictChipClass(d) {
    const v = d.verdict || "";
    if (/test pressing|partial release/.test(v)) return "error";
    if (/^strong|^audiophile/.test(v)) return "gold";
    if (/^solid/.test(v)) return "success";
    return "";
  }

  const releaseUrl = (id) => `${DISCOGS}/release/${id}`;
  const fmtScore = (n) => (Math.round(n * 10) / 10).toString();
  const pct = (x) => `${Math.round(x * 100)}%`;

  function marketLine(d) {
    const parts = [];
    if (d.lowestPrice != null) parts.push(`from $${d.lowestPrice}`);
    parts.push(`${d.numForSale} for sale`);
    return parts.join(" · ");
  }

  // ------------------------------------------------------------- messaging
  function requestAnalyze(params) {
    if (DEMO !== null) {
      const fx = window.COPILOT_FIXTURES;
      return new Promise((resolve) =>
        setTimeout(() => {
          if (DEMO === "setup") return resolve({ needsSetup: true });
          if (DEMO === "ratelimited") return resolve({ rateLimited: true, retryAfter: 42 });
          const data = params.masterId ? fx.master : fx.release;
          resolve({ data: { ...data, axis: params.axis } });
        }, 600)
      );
    }
    return chrome.runtime.sendMessage({ type: "analyze", ...params });
  }

  function requestResolveListing(tabId) {
    if (DEMO !== null) return Promise.resolve({ releaseId: 6276183 });
    return chrome.runtime.sendMessage({ type: "resolveListing", tabId });
  }

  // ------------------------------------------------------------- routing
  function routeFromUrl(url) {
    if (!url) return { kind: "empty", reason: "notDiscogs" };
    let u;
    try { u = new URL(url); } catch { return { kind: "empty", reason: "notDiscogs" }; }
    if (!/(^|\.)discogs\.com$/.test(u.hostname)) return { kind: "empty", reason: "notDiscogs" };

    let m = u.pathname.match(/\/release\/(\d+)/);
    if (m) return { kind: "release", id: Number(m[1]) };
    m = u.pathname.match(/\/master\/(\d+)/);
    if (m) return { kind: "master", id: Number(m[1]) };
    m = u.pathname.match(/\/sell\/item\/(\d+)/);
    if (m) return { kind: "listing", listingId: Number(m[1]) };
    if (/\/collection|\/wantlist|\/wants/.test(u.pathname + u.search)) {
      return { kind: "empty", reason: "v02" };
    }
    return { kind: "empty", reason: "discogsOther" };
  }

  function routeKey() {
    const r = state.route;
    const id = r.kind === "listing" ? `${r.listingId}/${state.listingReleaseId ?? "?"}` : r.id;
    return `${r.kind}:${id}:${state.axis}`;
  }

  // ------------------------------------------------------------- templates
  function chipsHtml(items) {
    return `<div class="m3-chips">${items.filter(Boolean).join("")}</div>`;
  }
  const chip = (cls, text) => `<span class="m3-chip ${cls}">${text}</span>`;

  function coverageHtml(d) {
    const thin = d.evidenceCoverage < 0.35;
    return `
      <div class="m3-cov">
        <div class="top"><span>Evidence coverage</span><span>${esc(d.evidenceCoverage.toFixed(2))}</span></div>
        <div class="m3-linear"><i style="width:${pct(d.evidenceCoverage)}"></i></div>
        ${thin ? '<div class="warn">⚠ Thin data — treat this verdict as low-confidence.</div>' : ""}
      </div>`;
  }

  function caveatsHtml(caveats) {
    if (!caveats?.length) return "";
    return `
      <details class="m3-caveats">
        <summary>Data caveats (${caveats.length})</summary>
        <ul>${caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      </details>`;
  }

  function kvRow(k, v) {
    return v ? `<div class="m3-kv"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>` : "";
  }

  function dossierCardHtml(d, caveats) {
    const signals = (d.signals || []).slice(0, 3);
    const matrix = (d.matrixRunout || []).slice(0, 2).map((x) => esc(x.value)).join("<br>");
    const engineers = (d.masteringCredits || []).join(", ");
    const plants = (d.pressingCompanies || []).map((c) => c.name).join(", ");
    const delta = d.ratingDelta?.value;
    const rating = d.ratingCount
      ? `${d.rating.toFixed(2)} (${d.ratingCount} ratings)` +
        (delta != null ? ` · Δ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs album` : "")
      : "not enough ratings";

    // whyItScores is the top signals joined (see pressing-dossier.ts), so it's
    // only worth showing when there's no signal list to render.
    return `
      <div class="m3-card">
        <div class="m3-overline">Evidence dossier</div>
        ${signals.length
          ? `<ul class="m3-signals">${signals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
          : `<div class="m3-why">${esc(d.whyItScores)}</div>`}
        <hr class="m3-divider" />
        ${kvRow("Matrix", matrix)}
        ${kvRow("Engineer", esc(engineers))}
        ${kvRow("Plant", esc(plants))}
        ${kvRow("Rating", esc(rating))}
        ${kvRow("Market", esc(marketLine(d)))}
        ${caveats?.length ? '<hr class="m3-divider" />' : ""}
        ${caveatsHtml(caveats)}
      </div>`;
  }

  // ------------------------------------------------------------- views
  function renderEmpty(reason) {
    $seg.hidden = true;
    const v02 =
      reason === "v02"
        ? '<div class="detail" style="margin-top:8px">Collection &amp; wantlist intelligence is coming in v0.2.</div>'
        : "";
    $body.innerHTML = `
      <div class="m3-state">
        <div class="icon">◎</div>
        <div class="headline">Nothing to analyze here</div>
        <div class="detail">Open a Discogs <b>release</b>, <b>master</b> or <b>marketplace listing</b> and the pressing dossier appears here.</div>
        ${v02}
      </div>`;
  }

  function renderSetup() {
    $seg.hidden = true;
    $body.innerHTML = `
      <div class="m3-state">
        <div class="icon">🔑</div>
        <div class="headline">Connect your Discogs account</div>
        <div class="detail">Paste a Discogs <b>personal access token</b> in the extension settings. It stays on this device and is only sent to your Discogs&nbsp;MCP server.</div>
        <div class="m3-actions"><button class="m3-btn filled" data-action="open-settings">Open settings</button></div>
      </div>`;
  }

  function renderLoading(kind) {
    const copy =
      kind === "master"
        ? "Surveying pressings of this album — a first look takes ~15 s. Repeat visits are near-instant (server cache)."
        : "Surveying this album's pressings — a first look takes ~15 s. Repeat visits are near-instant (server cache).";
    $body.innerHTML = `
      <div class="m3-loading">
        <div class="m3-linear indet"><i></i></div>
        <div class="copy">${esc(copy)}</div>
        <div class="m3-skelrow" style="width:70%"></div>
        <div class="m3-skelrow" style="width:90%"></div>
        <div class="m3-skelrow" style="width:55%"></div>
      </div>`;
  }

  function renderRateLimited(retryAfter) {
    $body.innerHTML = `
      <div class="m3-state">
        <div class="icon">⏳</div>
        <div class="headline">Discogs rate limit reached</div>
        <div class="detail">The analysis uses your own Discogs request budget (60/min). Try again in ~${esc(retryAfter)}s — already-surveyed pressings are cached, so the retry is fast.</div>
        <div class="m3-actions"><button class="m3-btn tonal" data-action="retry">Retry</button></div>
      </div>`;
  }

  function renderError(message) {
    $body.innerHTML = `
      <div class="m3-state">
        <div class="icon">⚠️</div>
        <div class="headline">Analysis failed</div>
        <div class="detail">${esc(message)}</div>
        <div class="m3-actions"><button class="m3-btn tonal" data-action="retry">Retry</button></div>
      </div>`;
  }

  function renderRelease(data, { listing = false } = {}) {
    const d = data.thisPressing;
    const best = data.bestPressing;
    const r = data.release;
    const isBest = best && best.releaseId === d.releaseId;
    const flagged = /test pressing|partial release/.test(d.verdict);

    const headerChips = chipsHtml([
      chip(verdictChipClass(d), esc(d.verdict)),
      chip("primary", `score ${fmtScore(d.overallScore)}`),
      isBest ? chip("gold", `◎ top ${esc(data.axis)} pick`) : "",
      data.owned ? chip("success", "✓ in your collection") : "",
      data.wanted ? chip("gold", "♡ on your wantlist") : "",
      data.tasteFit ? chip("", `taste fit ${esc(data.tasteFit.affinity)}%`) : "",
    ]);

    const bestCard =
      best && !isBest
        ? `
      <div class="m3-card">
        <div class="m3-overline">Best ${esc(data.axis)} pressing of this album</div>
        <div class="m3-title" style="font-size:14.5px">${esc(best.year || "")} · ${esc(best.label)} ${esc(best.catno)}</div>
        <div class="m3-sub">${esc(best.format)}${best.country ? " · " + esc(best.country) : ""}</div>
        ${chipsHtml([
          chip(verdictChipClass(best), esc(best.verdict)),
          chip("primary", `score ${fmtScore(best.overallScore)}`),
          chip("", `+${fmtScore(best.overallScore - d.overallScore)} vs this copy`),
          best.inYourCollection ? chip("success", "✓ you own it") : "",
        ])}
        <div class="m3-kv" style="margin-top:10px"><div class="k">Market</div><div class="v">${esc(marketLine(best))}</div></div>
        <div class="m3-actions">
          <a class="m3-btn tonal" href="${releaseUrl(best.releaseId)}" target="_blank" rel="noreferrer">View on Discogs ↗</a>
        </div>
      </div>`
        : "";

    $body.innerHTML = `
      ${listing ? '<div class="m3-overline">From this marketplace listing</div>' : ""}
      <div class="m3-card filled">
        <div class="m3-overline">This pressing</div>
        <div class="m3-title" style="margin-top:6px">${esc((r.artists || []).join(", "))} — ${esc(r.title)}</div>
        <div class="m3-sub">${esc(r.year || "?")} · ${esc(r.label)} ${esc(r.catno)} · ${esc(r.format)}${r.country ? " · " + esc(r.country) : ""}</div>
        ${headerChips}
        ${flagged ? '<div class="m3-cov"><div class="warn">⚠ Not a standard retail copy of the full album — score is penalized accordingly.</div></div>' : ""}
        ${coverageHtml(d)}
      </div>
      ${bestCard}
      ${dossierCardHtml(d, data.dataCaveats)}`;
  }

  function renderMaster(data) {
    const a = data.album;
    const rows = (data.topPressings || [])
      .map((p, i) => {
        return `
        <div class="m3-wrow ${i === 0 ? "top" : ""}">
          <div class="m3-rank">${p.rank ?? i + 1}</div>
          <div style="flex:1;min-width:0">
            <div class="m3-title" style="font-size:14px">${esc(p.year || "")} · ${esc(p.label)} ${esc(p.catno)}</div>
            <div class="m3-sub">${esc(p.format)}${p.country ? " · " + esc(p.country) : ""} · ${esc(marketLine(p))}</div>
            ${chipsHtml([
              chip(verdictChipClass(p), esc(p.verdict)),
              p.inYourCollection ? chip("success", "✓ you own it") : "",
            ])}
            <div class="m3-actions" style="margin-top:10px">
              <a class="m3-btn text" style="height:30px;padding:0 6px" href="${releaseUrl(p.releaseId)}" target="_blank" rel="noreferrer">View on Discogs ↗</a>
            </div>
          </div>
          <div class="m3-score">${fmtScore(p.overallScore)}</div>
        </div>`;
      })
      .join("");

    $body.innerHTML = `
      <div class="m3-card filled">
        <div class="m3-overline">Best ${esc(data.axis)} pressings</div>
        <div class="m3-title" style="margin-top:6px">${esc((a.artists || []).join(", "))} — ${esc(a.title)}</div>
        <div class="m3-sub">original release ${esc(a.originalYear || "?")} · scored ${esc(a.candidatesScored)} of ${esc(a.totalVersionsSurveyed)} versions</div>
        ${data.partial ? chipsHtml([chip("error", "partial survey — rate-limited, retry in ~60 s")]) : ""}
      </div>
      ${rows || '<div class="m3-state"><div class="detail">No scorable pressings found.</div></div>'}
      ${data.note ? `<div class="m3-sub">${esc(data.note)}</div>` : ""}
      ${caveatsHtml(data.dataCaveats)}`;
  }

  function renderListingIntro({ unresolved = false } = {}) {
    const detail = unresolved
      ? 'Couldn\'t find this listing\'s release link on the page — open the release page itself and the dossier loads automatically.'
      : "Analysis is button-triggered here so browsing listings doesn't burn your Discogs rate budget.";
    $body.innerHTML = `
      <div class="m3-card filled">
        <div class="m3-overline">Marketplace listing</div>
        <div class="m3-title" style="margin-top:6px">Pressing check</div>
        <div class="m3-sub">${detail}</div>
        ${unresolved ? "" : `
        <div class="m3-actions">
          <button class="m3-btn filled" data-action="analyze-listing">Analyze this pressing</button>
        </div>`}
      </div>`;
  }

  // ------------------------------------------------------------- controller
  async function run() {
    const key = routeKey();
    const r = state.route;
    const seq = ++state.seq;

    $seg.hidden = !(r.kind === "release" || r.kind === "master" || r.kind === "listing");

    if (r.kind === "empty") { state.lastKey = key; renderEmpty(r.reason); return; }

    if (r.kind === "listing" && !state.listingReleaseId) {
      state.lastKey = key;
      renderListingIntro();
      return;
    }

    if (key === state.lastKey) return; // already rendered (courtesy debounce backstop)

    renderLoading(r.kind);
    const params =
      r.kind === "master"
        ? { masterId: r.id, axis: state.axis }
        : { releaseId: r.kind === "listing" ? state.listingReleaseId : r.id, axis: state.axis };

    let res;
    try {
      res = await requestAnalyze(params);
    } catch (e) {
      res = { error: e.message || "Internal messaging error." };
    }
    if (seq !== state.seq) return; // a newer navigation superseded this request

    if (!res) { renderError("No response from the extension service worker."); return; }
    if (res.needsSetup) { renderSetup(); return; }
    if (res.rateLimited) { renderRateLimited(res.retryAfter); return; }
    if (res.error) { renderError(res.error); return; }

    state.lastKey = key;
    if (r.kind === "master") renderMaster(res.data);
    else renderRelease(res.data, { listing: r.kind === "listing" });
  }

  const scheduleRun = debounce(run, 250);

  function setRoute(url, tabId) {
    const next = routeFromUrl(url);
    const changed =
      next.kind !== state.route.kind ||
      next.id !== state.route.id ||
      next.listingId !== state.route.listingId;
    if (tabId !== undefined) state.tabId = tabId;
    if (changed) {
      state.route = next;
      state.listingReleaseId = null;
      state.lastKey = null;
    }
    scheduleRun();
  }

  // ------------------------------------------------------------- events
  $seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-axis]");
    if (!b || b.dataset.axis === state.axis) return;
    state.axis = b.dataset.axis;
    $seg.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b));
    state.lastKey = null;
    scheduleRun();
  });

  document.getElementById("btn-settings").addEventListener("click", () => {
    if (IS_EXT) chrome.runtime.openOptionsPage();
    else alert("Demo mode — the real panel opens the extension options page.");
  });

  $body.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "open-settings") {
      if (IS_EXT) chrome.runtime.openOptionsPage();
      return;
    }
    if (action === "retry") {
      state.lastKey = null;
      run();
      return;
    }
    if (action === "analyze-listing") {
      renderLoading("release");
      const res = await requestResolveListing(state.tabId);
      if (res?.releaseId) {
        state.listingReleaseId = res.releaseId;
        state.lastKey = null;
        run();
      } else {
        renderListingIntro({ unresolved: true });
      }
    }
  });

  // ------------------------------------------------------------- init
  if (DEMO !== null) {
    $sub.textContent = "demo mode · fixture data";
    const demoRoutes = {
      release: { kind: "release", id: 6276183 },
      master: { kind: "master", id: 5460 },
      listing: { kind: "listing", listingId: 123456789 },
      empty: { kind: "empty", reason: "notDiscogs" },
      v02: { kind: "empty", reason: "v02" },
      setup: { kind: "release", id: 6276183 },
      ratelimited: { kind: "release", id: 6276183 },
      loading: { kind: "release", id: 6276183 },
    };
    state.route = demoRoutes[DEMO] || demoRoutes.release;
    if (DEMO === "loading") {
      $seg.hidden = false;
      renderLoading("release");
    } else {
      run();
    }
    return;
  }

  chrome.windows.getCurrent().then((w) => {
    state.windowId = w.id;
  });

  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab) setRoute(tab.url, tab.id);
  });

  chrome.tabs.onActivated.addListener(async (info) => {
    if (state.windowId !== null && info.windowId !== state.windowId) return;
    try {
      const tab = await chrome.tabs.get(info.tabId);
      setRoute(tab.url, tab.id);
    } catch {
      // tab vanished between events
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== state.tabId || !changeInfo.url) return;
    setRoute(changeInfo.url, tabId);
  });

  // Re-render when the token or base URL changes (e.g. after first setup).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes.token || changes.baseUrl)) return;
    state.lastKey = null;
    scheduleRun();
  });
})();
