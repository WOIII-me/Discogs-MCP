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
    enrichCtx: null, // current release's params for the manual enrich action
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
      // &fast=1 skips the simulated latency (for automated screenshots)
      const delay = new URLSearchParams(location.search).has("fast") ? 0 : 600;
      return new Promise((resolve) =>
        setTimeout(() => {
          if (DEMO === "setup") return resolve({ needsSetup: true });
          if (DEMO === "ratelimited") return resolve({ rateLimited: true, retryAfter: 42 });
          if (params.mode === "summary" && !params.masterId) {
            return resolve({ data: { ...fx.summary, axis: params.axis } });
          }
          if (DEMO === "deferred" && !params.masterId) {
            return resolve({ deferred: true, retryAfter: 12 });
          }
          const data = params.masterId ? fx.master : fx.release;
          resolve({ data: { ...data, axis: params.axis } });
        }, delay)
      );
    }
    return chrome.runtime.sendMessage({ type: "analyze", ...params });
  }

  function requestResolveListing(tabId) {
    if (DEMO !== null) return Promise.resolve({ releaseId: 6276183 });
    return chrome.runtime.sendMessage({ type: "resolveListing", tabId });
  }

  function requestAuthStatus() {
    if (DEMO !== null) {
      return Promise.resolve(DEMO === "home" ? { method: "oauth", username: "vinylfan" } : { method: "none" });
    }
    return chrome.runtime.sendMessage({ type: "authStatus" });
  }

  function requestProfile() {
    if (DEMO !== null) return Promise.resolve({ data: window.COPILOT_FIXTURES.profile });
    return chrome.runtime.sendMessage({ type: "profile" });
  }

  function requestSpin(mood) {
    if (DEMO !== null) {
      const fx = window.COPILOT_FIXTURES.spin;
      return new Promise((resolve) => setTimeout(() => resolve({ data: { ...fx, mood } }), 350));
    }
    return chrome.runtime.sendMessage({ type: "spin", mood });
  }

  function requestRecentAnalyses() {
    if (DEMO !== null) return Promise.resolve({ items: window.COPILOT_FIXTURES.recentAnalyses });
    return chrome.runtime.sendMessage({ type: "recentAnalyses" });
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
    m = u.pathname.match(/\/(?:sell|shop)\/item\/(\d+)/);
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
  const DEFAULT_SUB = "pressing intelligence";

  // The app bar's "● username · connected" is set when the home view loads;
  // signed-out views must take it back down (demo keeps its own label).
  function resetSub() {
    if (DEMO === null) $sub.textContent = DEFAULT_SUB;
  }

  function renderEmpty(reason) {
    $seg.hidden = true;
    resetSub();
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

  function renderSetup({ busy = false, error = "" } = {}) {
    $seg.hidden = true;
    resetSub();
    $body.innerHTML = `
      <div class="m3-state">
        <div class="icon">🔑</div>
        <div class="headline">Connect your Discogs account</div>
        <div class="detail">Sign in with Discogs to get pressing verdicts, taste fit and owned/wanted badges. Read-only — nothing ever modifies your collection.</div>
        ${error ? `<div class="detail" style="margin-top:8px;color:var(--md-on-error-container)">${esc(error)}</div>` : ""}
        <div class="m3-actions">
          <button class="m3-btn filled" data-action="sign-in" ${busy ? "disabled" : ""}>${busy ? "Waiting for Discogs…" : "Sign in with Discogs"}</button>
        </div>
        <div class="m3-actions" style="margin-top:2px">
          <button class="m3-btn text" data-action="open-settings">Settings (self-host / token)</button>
        </div>
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

  function renderRelease(data, { listing = false, enriching = false, stale = false } = {}) {
    const d = data.thisPressing;
    const best = data.bestPressing;
    const r = data.release;
    const isBest = best && best.releaseId === d.releaseId;
    const flagged = /test pressing|partial release/.test(d.verdict);
    const meta = data.meta;
    const partialSurvey =
      meta && meta.candidatesScored != null && meta.candidatesTarget != null && meta.candidatesScored < meta.candidatesTarget;

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
          chip("", `${best.overallScore >= d.overallScore ? "+" : "−"}${fmtScore(Math.abs(best.overallScore - d.overallScore))} vs this copy`),
          best.inYourCollection ? chip("success", "✓ you own it") : "",
        ])}
        ${partialSurvey ? `<div class="m3-sub" style="margin-top:8px">⚠ Partial survey — scored ${esc(meta.candidatesScored)} of ${esc(meta.candidatesTarget)} candidates (rate budget); re-check in a minute for the full ranking.</div>` : ""}
        <div class="m3-kv" style="margin-top:10px"><div class="k">Market</div><div class="v">${esc(marketLine(best))}</div></div>
        <div class="m3-actions">
          <a class="m3-btn tonal" href="${releaseUrl(best.releaseId)}" target="_blank" rel="noreferrer">View on Discogs ↗</a>
        </div>
      </div>`
        : "";

    $body.innerHTML = `
      ${listing ? '<div class="m3-overline">From this marketplace listing</div>' : ""}
      ${stale ? '<div class="m3-sub" style="margin:0 2px 8px">⏳ Showing a saved result — Discogs is rate-limited right now; it refreshes automatically on your next visit.</div>' : ""}
      <div class="m3-card filled">
        <div class="m3-overline">This pressing</div>
        <div class="m3-title" style="margin-top:6px">${esc((r.artists || []).join(", "))} — ${esc(r.title)}</div>
        <div class="m3-sub">${esc(r.year || "?")} · ${esc(r.label)} ${esc(r.catno)} · ${esc(r.format)}${r.country ? " · " + esc(r.country) : ""}</div>
        ${headerChips}
        ${flagged ? '<div class="m3-cov"><div class="warn">⚠ Not a standard retail copy of the full album — score is penalized accordingly.</div></div>' : ""}
        ${coverageHtml(d)}
      </div>
      ${bestCard}
      ${enriching ? `<div class="m3-card" id="enrich-slot">${enrichSlotHtml({ kind: "loading" })}</div>` : ""}
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
      ? "Couldn't find this listing's release link — the page may still be loading. Try again in a moment, or open the release page itself (dossier loads automatically there)."
      : "Analysis is button-triggered here so browsing listings doesn't burn your Discogs rate budget.";
    $body.innerHTML = `
      <div class="m3-card filled">
        <div class="m3-overline">Marketplace listing</div>
        <div class="m3-title" style="margin-top:6px">Pressing check</div>
        <div class="m3-sub">${detail}</div>
        <div class="m3-actions">
          <button class="m3-btn ${unresolved ? "tonal" : "filled"}" data-action="analyze-listing">${unresolved ? "Try again" : "Analyze this pressing"}</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------- home view
  // Non-analyzable page + signed in → "Your shelf": judgments and deltas the
  // Discogs page never synthesizes. Served from cached aggregates only.

  const MOOD_CHIPS = ["mellow", "groovy", "energetic", "latenight", "dark", "smooth", "psychedelic", "nostalgic"];
  let spinSeq = 0; // stale-guard for mood taps

  function fmtAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 2) return "just now";
    if (m < 60) return `${m}m ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }

  function fmtDay(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function shelfOpinion(p) {
    const parts = [];
    const style = p.dominantStyles[0]?.name;
    const decade = p.decades[0]?.name;
    if (decade && style) parts.push(`Leans ${decade} ${style}`);
    else if (style) parts.push(`Leans ${style}`);
    if (p.topLabels[0]) parts.push(`${p.topLabels[0]} heavy`);
    if (p.formatSplit.vinyl >= 40) parts.push(`${p.formatSplit.vinyl}% vinyl`);
    else if (p.formatSplit.cd >= 40) parts.push(`${p.formatSplit.cd}% CD`);
    return parts.join(" · ") || "Analyze a few records and your shelf profile appears here";
  }

  function shelfCardHtml(p) {
    const maxShare = p.dominantStyles[0]?.share || 1;
    const bars = p.dominantStyles
      .map(
        (s) => `
        <div class="m3-bar">
          <div class="name">${esc(s.name)}</div>
          <div class="m3-linear"><i style="width:${pct(Math.min(1, s.share / maxShare))}"></i></div>
          <div class="pct">${esc(s.share)}%</div>
        </div>`
      )
      .join("");
    const genresLine = p.dominantGenres.length
      ? `<div class="m3-sub" style="margin-top:10px">${esc(p.dominantGenres.join(" · "))}${
          p.decades[0] ? ` — leans ${esc(p.decades[0].name)} (${esc(p.decades[0].share)}%)` : ""
        }</div>`
      : "";
    const user = encodeURIComponent(p.username);
    return `
      <div class="m3-card filled">
        <div class="m3-overline">Your shelf</div>
        <div class="m3-title" style="margin-top:6px">${esc(shelfOpinion(p))}</div>
        ${p.truncated ? '<div class="m3-sub">profiled from your first 3,000 records</div>' : ""}
        ${bars ? `<div class="m3-bars">${bars}</div>` : ""}
        ${genresLine}
        <div class="m3-stats">
          <a class="m3-stat" href="${DISCOGS}/user/${user}/collection" target="_blank" rel="noreferrer">
            <div class="n">${esc(p.collectionSize)}</div><div class="l">collection ↗</div>
          </a>
          <a class="m3-stat" href="${DISCOGS}/wantlist?user=${user}" target="_blank" rel="noreferrer">
            <div class="n">${esc(p.wantlistSize)}</div><div class="l">wantlist ↗</div>
          </a>
          <div class="m3-stat">
            <div class="n">+${esc(p.addedThisMonth)}</div><div class="l">this month</div>
          </div>
        </div>
      </div>`;
  }

  function spinCardHtml(moods) {
    const chips = MOOD_CHIPS.filter((m) => !moods || moods.includes(m))
      .map((m) => `<button class="m3-chip" data-action="spin" data-mood="${esc(m)}">${esc(m)}</button>`)
      .join("");
    return `
      <div class="m3-card">
        <div class="m3-overline">What to spin tonight</div>
        <div class="m3-chips">${chips}</div>
        <div id="spin-result"></div>
      </div>`;
  }

  function spinPicksHtml(data) {
    return `
      <div class="m3-minis" style="margin-top:12px">
        ${data.picks
          .map(
            (k) => `
          <button class="m3-mini" data-action="open-release" data-id="${esc(k.id)}">
            <div class="txt">
              <div class="t">${esc(k.artists.join(", "))} — ${esc(k.title)}</div>
              <div class="s">${esc(k.why)}${k.year ? ` · ${esc(k.year)}` : ""}</div>
            </div>
            <div class="right">${k.rating ? `<span class="m3-chip gold">${"★".repeat(k.rating)}</span>` : ""}</div>
          </button>`
          )
          .join("")}
      </div>
      <div class="m3-sub">${esc(data.poolSize)} matches on your shelf · tap the mood again to re-roll</div>`;
  }

  function recentAnalysesHtml(items) {
    if (!items?.length) return "";
    return `
      <div class="m3-card">
        <div class="m3-overline">Recently analyzed</div>
        <div class="m3-minis">
          ${items
            .slice(0, 6)
            .map(
              (e) => `
            <button class="m3-mini" data-action="open-release" data-id="${esc(e.releaseId)}">
              <div class="txt">
                <div class="t">${esc(e.artist)} — ${esc(e.title)}</div>
                <div class="s">${esc(e.verdict)} · ${esc(e.axis)} · ${esc(fmtAgo(e.ts))}</div>
              </div>
              <div class="right"><span class="m3-chip ${verdictChipClass(e)}">${esc(fmtScore(e.score))}</span></div>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function recentlyAddedHtml(p) {
    if (!p?.recentlyAdded?.length) return "";
    return `
      <div class="m3-card">
        <div class="m3-overline">Recently added to your collection</div>
        <div class="m3-minis">
          ${p.recentlyAdded
            .map(
              (r) => `
            <button class="m3-mini" data-action="open-release" data-id="${esc(r.id)}">
              <div class="txt">
                <div class="t">${esc(r.artists.join(", "))} — ${esc(r.title)}</div>
                <div class="s">${esc(r.year || "")}</div>
              </div>
              <div class="right"><span class="m3-sub">${esc(r.dateAdded ? fmtDay(r.dateAdded) : "")}</span></div>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderHome(profile, recent, note) {
    $seg.hidden = true;
    if (profile?.username) $sub.textContent = `● ${profile.username} · connected`;
    const shelf = profile
      ? shelfCardHtml(profile)
      : `
      <div class="m3-card filled">
        <div class="m3-overline">Your shelf</div>
        <div class="m3-sub" style="margin-top:8px">${esc(note || "Shelf profile unavailable right now.")}</div>
        <div class="m3-actions"><button class="m3-btn tonal" data-action="home-retry">Retry</button></div>
      </div>`;
    $body.innerHTML = `
      ${shelf}
      ${spinCardHtml(profile?.moods)}
      ${recentAnalysesHtml(recent)}
      ${recentlyAddedHtml(profile)}
      <div class="m3-teaser">Ranked wantlist &amp; marketplace views — coming next</div>`;
  }

  function renderHomeLoading() {
    $seg.hidden = true;
    $body.innerHTML = `
      <div class="m3-loading">
        <div class="m3-linear indet"><i></i></div>
        <div class="copy">Reading your shelf…</div>
        <div class="m3-skelrow" style="width:70%"></div>
        <div class="m3-skelrow" style="width:90%"></div>
        <div class="m3-skelrow" style="width:55%"></div>
      </div>`;
  }

  async function runHome(seq) {
    const loadingTimer = setTimeout(renderHomeLoading, 250);
    let profileRes;
    let recentRes;
    try {
      [profileRes, recentRes] = await Promise.all([requestProfile(), requestRecentAnalyses()]);
    } catch (e) {
      profileRes = { error: e.message || "Internal messaging error." };
      recentRes = { items: [] };
    }
    clearTimeout(loadingTimer);
    if (seq !== state.seq) return;

    const recent = recentRes?.items ?? [];
    if (profileRes?.data) {
      renderHome(profileRes.data, recent);
    } else if (profileRes?.needsSetup) {
      // Signed out from under us — fall back to the plain empty state
      state.lastKey = null;
      renderEmpty(state.route.reason);
      return;
    } else if (profileRes?.rateLimited) {
      renderHome(null, recent, `Discogs rate limit reached — try again in ~${profileRes.retryAfter ?? 60}s.`);
    } else {
      renderHome(null, recent, profileRes?.error || "Shelf profile unavailable right now.");
    }
    state.lastKey = "home";
  }

  async function handleSpinTap(chip) {
    const mood = chip.dataset.mood;
    const seq = ++spinSeq;
    $body.querySelectorAll('[data-action="spin"]').forEach((c) => c.classList.toggle("primary", c === chip));
    const $out = document.getElementById("spin-result");
    if (!$out) return;
    $out.innerHTML = '<div class="m3-linear indet" style="margin-top:14px"><i></i></div>';
    let res;
    try {
      res = await requestSpin(mood);
    } catch (e) {
      res = { error: e.message || "Internal messaging error." };
    }
    if (seq !== spinSeq || !document.getElementById("spin-result")) return;
    const $out2 = document.getElementById("spin-result");
    if (res?.data) {
      $out2.innerHTML = spinPicksHtml(res.data);
    } else {
      const msg = res?.rateLimited
        ? `Discogs rate limit — retry in ~${res.retryAfter ?? 60}s.`
        : res?.error || "Couldn't pick anything.";
      $out2.innerHTML = `<div class="m3-sub" style="margin-top:12px">${esc(msg)}</div>`;
    }
  }

  function openRelease(id) {
    const url = releaseUrl(id);
    if (!IS_EXT) {
      window.open(url, "_blank", "noreferrer");
    } else if (state.tabId != null) {
      // Same tab, so the panel follows and re-analyzes (instant when cached)
      chrome.tabs.update(state.tabId, { url });
    } else {
      chrome.tabs.create({ url });
    }
  }

  // ------------------------------------------------------------- controller
  async function run() {
    const key = routeKey();
    const r = state.route;
    const seq = ++state.seq;

    $seg.hidden = !(r.kind === "release" || r.kind === "master" || r.kind === "listing");

    if (r.kind === "empty") {
      // Signed in on a non-analyzable page → the "Your shelf" home view.
      let auth;
      try {
        auth = await requestAuthStatus();
      } catch {
        auth = { method: "none" };
      }
      if (seq !== state.seq) return;
      if (!auth || auth.method === "none") {
        state.lastKey = null;
        renderEmpty(r.reason);
        return;
      }
      if (state.lastKey === "home") return; // keep spin picks etc. across tab switches
      await runHome(seq);
      return;
    }

    if (r.kind === "listing" && !state.listingReleaseId) {
      state.lastKey = key;
      renderListingIntro();
      return;
    }

    if (key === state.lastKey) return; // already rendered (courtesy debounce backstop)

    // Only show the loading skeleton if the answer isn't near-instant (cached
    // analyses resolve in ms — flashing a skeleton on every tab switch is jarring).
    const loadingTimer = setTimeout(() => renderLoading(r.kind), 250);
    const listing = r.kind === "listing";
    const params =
      r.kind === "master"
        ? { masterId: r.id, axis: state.axis }
        : { releaseId: listing ? state.listingReleaseId : r.id, axis: state.axis };

    // Progressive flow for releases: render the summary (≤1 cold Discogs
    // call) immediately; the full survey only runs if this page stays open.
    const twoStage = !!params.releaseId;

    let res;
    try {
      res = await requestAnalyze(twoStage ? { ...params, mode: "summary" } : params);
    } catch (e) {
      res = { error: e.message || "Internal messaging error." };
    }
    clearTimeout(loadingTimer);
    if (seq !== state.seq) return; // a newer navigation superseded this request

    if (!res) { renderError("No response from the extension service worker."); return; }
    if (res.needsSetup) { renderSetup(); return; }
    if (res.rateLimited && !res.data) { renderRateLimited(res.retryAfter); return; }
    if (res.deferred) {
      // Even the summary couldn't run — treat like a cooldown.
      renderRateLimited(res.retryAfter ?? 60);
      return;
    }
    if (res.error && !res.data) { renderError(res.error); return; }

    state.lastKey = key;
    if (r.kind === "master") {
      renderMaster(res.data);
      return;
    }
    const isFull = !res.data.meta || res.data.meta.level === "full";
    renderRelease(res.data, { listing, enriching: !isFull, stale: !!res.stale });
    if (!isFull) {
      state.enrichCtx = { key, params, listing };
      scheduleEnrichment(key, params, seq, listing);
    }
  }

  // ----------------------------------------------------- enrichment (stage 2)
  // The full survey is the expensive part (up to 16 candidate fetches on the
  // user's own budget) — it only starts after the same release stays open a
  // beat longer, and a cooldown defers it without losing the summary.
  const ENRICH_DELAY_MS = 1500;
  let countdownTimer = null;

  function enrichSlotHtml(state_) {
    if (state_.kind === "loading") {
      return `
        <div class="m3-overline">Best pressing of this album</div>
        <div class="m3-linear indet" style="margin-top:12px"><i></i></div>
        <div class="m3-sub" style="margin-top:8px">Surveying pressings — first look takes a few seconds…</div>`;
    }
    if (state_.kind === "deferred") {
      return `
        <div class="m3-overline">Best pressing of this album</div>
        <div class="m3-sub" style="margin-top:8px">Discogs rate budget is cooling down — retrying in <b id="enrich-count">${esc(state_.retryAfter)}</b>s. The verdict above stays usable.</div>
        <div class="m3-actions"><button class="m3-btn tonal" data-action="enrich-now">Analyze best pressings</button></div>`;
    }
    if (state_.kind === "ready") {
      return `
        <div class="m3-overline">Best pressing of this album</div>
        <div class="m3-sub" style="margin-top:8px">Cooldown finished.</div>
        <div class="m3-actions"><button class="m3-btn tonal" data-action="enrich-now">Analyze best pressings</button></div>`;
    }
    return `
      <div class="m3-overline">Best pressing of this album</div>
      <div class="m3-sub" style="margin-top:8px">${esc(state_.message || "Survey unavailable right now.")}</div>
      <div class="m3-actions"><button class="m3-btn tonal" data-action="enrich-now">Try again</button></div>`;
  }

  function setEnrichSlot(state_) {
    const slot = document.getElementById("enrich-slot");
    if (!slot) return false;
    slot.innerHTML = enrichSlotHtml(state_);
    return true;
  }

  function startCountdown(seconds) {
    clearInterval(countdownTimer);
    let left = seconds;
    countdownTimer = setInterval(() => {
      const el = document.getElementById("enrich-count");
      if (!el) { clearInterval(countdownTimer); return; }
      left--;
      if (left <= 0) {
        clearInterval(countdownTimer);
        setEnrichSlot({ kind: "ready" }); // the auto-retry (if armed) takes it from here
        return;
      }
      el.textContent = String(left);
    }, 1000);
  }

  async function runEnrichment(key, params, seq, listing, { autoRetry = true } = {}) {
    let res;
    try {
      res = await requestAnalyze({ ...params, mode: "full" });
    } catch (e) {
      res = { error: e.message || "Internal messaging error." };
    }
    if (seq !== state.seq || state.lastKey !== key) return; // navigated away

    if (res?.data) {
      renderRelease(res.data, { listing, stale: !!res.stale });
      return;
    }
    if (res?.needsSetup) { renderSetup(); return; }

    const retryAfter = res?.retryAfter ?? 60;
    if (res?.deferred || res?.rateLimited) {
      setEnrichSlot({ kind: "deferred", retryAfter });
      startCountdown(retryAfter);
      if (autoRetry) {
        // One automatic retry if the same page is still open after cooldown.
        setTimeout(() => {
          if (seq !== state.seq || state.lastKey !== key) return;
          setEnrichSlot({ kind: "loading" });
          runEnrichment(key, params, seq, listing, { autoRetry: false });
        }, (retryAfter + 2) * 1000);
      }
      return;
    }
    setEnrichSlot({ kind: "error", message: res?.error });
  }

  function scheduleEnrichment(key, params, seq, listing) {
    setTimeout(() => {
      if (seq !== state.seq || state.lastKey !== key) return; // moved on already
      setEnrichSlot({ kind: "loading" });
      runEnrichment(key, params, seq, listing);
    }, DEMO !== null ? 700 : ENRICH_DELAY_MS);
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
    if (action === "sign-in") {
      if (!IS_EXT) { alert("Demo mode — sign-in runs in the installed extension."); return; }
      renderSetup({ busy: true });
      const res = await chrome.runtime.sendMessage({ type: "signIn" });
      if (res?.username) {
        state.lastKey = null;
        run(); // storage.onChanged also fires, but re-run immediately
      } else {
        renderSetup({ error: res?.error || "Sign-in failed." });
      }
      return;
    }
    if (action === "retry" || action === "home-retry") {
      state.lastKey = null;
      run();
      return;
    }
    if (action === "spin") {
      handleSpinTap(btn);
      return;
    }
    if (action === "enrich-now") {
      const c = state.enrichCtx;
      if (!c || state.lastKey !== c.key) return;
      clearInterval(countdownTimer);
      setEnrichSlot({ kind: "loading" });
      runEnrichment(c.key, c.params, state.seq, c.listing, { autoRetry: false });
      return;
    }
    if (action === "open-release") {
      openRelease(Number(btn.dataset.id));
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
      home: { kind: "empty", reason: "discogsOther" },
      deferred: { kind: "release", id: 6276183 },
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

  // Re-render when auth or the base URL changes (e.g. after first setup,
  // sign-in from the options page, or sign-out). Routine token refreshes
  // rewrite oauthTokens too — only presence toggles matter here.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const sessionToggled =
      changes.oauthTokens && !changes.oauthTokens.oldValue !== !changes.oauthTokens.newValue;
    if (!(changes.token || changes.baseUrl || sessionToggled)) return;
    state.lastKey = null;
    scheduleRun();
  });
})();
