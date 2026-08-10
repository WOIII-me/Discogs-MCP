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
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
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
  // The panel is an answer, not a dashboard: judgment renders as toned TEXT
  // (good / fair / poor), numbers as plain numerals, detail behind one
  // disclosure. No gauges, no bars, no badges.

  /** Judgment tone for verdicts and scores. */
  function tone(d) {
    const c = verdictChipClass(d);
    return c === "gold" ? "good" : c === "success" ? "fair" : c === "error" ? "poor" : "plain";
  }

  function coverageWord(c) {
    if (c >= 0.85) return "well documented";
    if (c >= 0.6) return "good evidence";
    if (c >= 0.35) return "partial evidence";
    return "thin evidence — low confidence";
  }

  function fitWord(aff) {
    if (aff >= 60) return "right in your lane";
    if (aff >= 35) return "close to your shelf";
    if (aff >= 15) return "a stretch for your shelf";
    return "outside your usual lane";
  }

  const FACTOR_NAMES = {
    pedigree: "pedigree",
    format: "format",
    ratingDelta: "community",
    marketValue: "market",
    scarcity: "scarcity",
    demand: "demand",
  };

  function factorGrade(s) {
    return s >= 80 ? "strong" : s >= 55 ? "good" : s >= 30 ? "fair" : "weak";
  }

  /** One quiet text line: "pedigree weak · community good · format good". */
  function factorsLine(factors) {
    if (!factors) return "";
    const parts = Object.entries(factors)
      .filter(([, f]) => f && typeof f.score === "number" && f.confidence > 0)
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 4)
      .map(([k, f]) => `${FACTOR_NAMES[k] || k} ${factorGrade(f.score)}`);
    return parts.join(" · ");
  }

  function evidenceHtml(d, caveats) {
    const matrix = (d.matrixRunout || []).slice(0, 2).map((x) => esc(x.value)).join("<br>");
    const engineers = (d.masteringCredits || []).join(", ");
    const plants = (d.pressingCompanies || []).map((c) => c.name).join(", ");
    const delta = d.ratingDelta?.value;
    const rating = d.ratingCount
      ? `${d.rating.toFixed(2)} of 5 (${d.ratingCount} ratings)` +
        (delta != null ? ` · ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} vs album` : "")
      : "not enough ratings";
    const factors = factorsLine(d.factors);

    return `
      <details class="evidence">
        <summary>Evidence</summary>
        <div class="ev-body">
          ${matrix ? `<div class="kv"><div class="k">Dead wax</div><div class="v mono">${matrix}</div></div>` : ""}
          ${engineers ? `<div class="kv"><div class="k">Engineer</div><div class="v">${esc(engineers)}</div></div>` : ""}
          ${plants ? `<div class="kv"><div class="k">Plant</div><div class="v">${esc(plants)}</div></div>` : ""}
          <div class="kv"><div class="k">Rating</div><div class="v">${esc(rating)}</div></div>
          <div class="kv"><div class="k">Market</div><div class="v">${esc(marketLine(d))}</div></div>
          ${factors ? `<div class="kv"><div class="k">Factors</div><div class="v">${esc(factors)}</div></div>` : ""}
          ${(caveats || []).map((c) => `<div class="ev-note">${esc(c)}</div>`).join("")}
          <div class="ev-note">Reputation-based, not measured sound. Read-only.</div>
        </div>
      </details>`;
  }

  // ------------------------------------------------------------- views
  const DEFAULT_SUB = "";

  function setSub(text) {
    if ($sub) $sub.textContent = text;
  }

  // The app bar's "● username · connected" is set when the home view loads;
  // signed-out views must take it back down (demo keeps its own label).
  function resetSub() {
    if (DEMO === null) setSub(DEFAULT_SUB);
  }

  function renderEmpty(reason) {
    $seg.hidden = true;
    resetSub();
    const v02 = reason === "v02" ? " Collection and wantlist views are coming in a later release." : "";
    $body.innerHTML = `
      <div class="state">
        <div class="headline">Nothing to analyze here</div>
        <div class="detail">Open a Discogs <b>release</b>, <b>master</b> or <b>marketplace listing</b> and the verdict appears here.${esc(v02)}</div>
      </div>`;
  }

  function renderSetup({ busy = false, error = "" } = {}) {
    $seg.hidden = true;
    resetSub();
    $body.innerHTML = `
      <div class="state">
        <div class="headline">Connect your Discogs account</div>
        <div class="detail">Pressing verdicts, taste fit and owned/wanted context. Read-only — nothing ever modifies your collection.</div>
        ${error ? `<div class="detail" style="margin-top:8px;color:var(--poor)">${esc(error)}</div>` : ""}
        <div class="actions">
          <button class="btn primary" data-action="sign-in" ${busy ? "disabled" : ""}>${busy ? "Waiting for Discogs…" : "Sign in with Discogs"}</button>
          <button class="btn quiet" data-action="open-settings">Settings</button>
        </div>
      </div>`;
  }

  function renderLoading() {
    $body.innerHTML = `
      <div class="sect">
        <div class="progress"><i></i></div>
        <div class="loading-copy">Surveying this album’s pressings — a first look takes ~15s. Repeat visits are near-instant.</div>
      </div>`;
  }

  function renderRateLimited(retryAfter) {
    $body.innerHTML = `
      <div class="state">
        <div class="headline">Discogs rate limit reached</div>
        <div class="detail">Analysis runs on your own request budget (60/min). Try again in ~${esc(retryAfter)}s — surveyed pressings are cached, so the retry is fast.</div>
        <div class="actions"><button class="btn" data-action="retry">Retry</button></div>
      </div>`;
  }

  function renderError(message) {
    $body.innerHTML = `
      <div class="state">
        <div class="headline">Analysis failed</div>
        <div class="detail">${esc(message)}</div>
        <div class="actions"><button class="btn" data-action="retry">Retry</button></div>
      </div>`;
  }

  function renderRelease(data, { listing = false, enriching = false, stale = false } = {}) {
    const d = data.thisPressing;
    const best = data.bestPressing;
    const isBest = best && best.releaseId === d.releaseId;
    const flagged = /test pressing|partial release/.test(d.verdict);
    const meta = data.meta;
    const partialSurvey =
      meta && meta.candidatesScored != null && meta.candidatesTarget != null && meta.candidatesScored < meta.candidatesTarget;
    const t = tone(d);

    // The page the user is looking at already names the record — the panel
    // answers. Marks and taste live on one quiet metadata line each.
    const marks = [
      data.owned ? "in your collection" : "",
      data.wanted ? "on your wantlist" : "",
    ].filter(Boolean).join(" · ");
    const fit = data.tasteFit ? fitWord(data.tasteFit.affinity) : "";

    const answer = `
      <div class="sect">
        ${listing ? '<div class="context">From this marketplace listing</div>' : ""}
        ${stale ? '<div class="context">Saved result — Discogs is rate-limited; refreshes on your next visit</div>' : ""}
        <div class="score tone-${t}">${esc(fmtScore(d.overallScore))}<span class="of">/ 100</span></div>
        <div class="verdict tone-${t}">${esc(cap(d.verdict))}</div>
        <div class="meta">${esc(coverageWord(d.evidenceCoverage))}${fit ? `<span class="sep"> · </span>${esc(fit)}` : ""}</div>
        ${marks ? `<div class="meta">${esc(marks)}</div>` : ""}
        ${flagged ? '<div class="caution">Not a standard retail copy of the full album — score is penalized.</div>' : ""}
      </div>`;

    let betterSect = "";
    if (isBest) {
      betterSect = `
        <div class="sect better">
          <div class="this-wins">This is the album’s best ${esc(data.axis)} pressing${meta?.candidatesScored ? ` of the ${esc(meta.candidatesScored)} surveyed` : ""}.</div>
        </div>`;
    } else if (best) {
      const delta = best.overallScore - d.overallScore;
      betterSect = `
        <div class="sect better">
          <div class="sect-h">A better copy exists</div>
          <div class="line">${esc(best.year || "")} · ${esc(best.label)} ${esc(best.catno)}${best.country ? " · " + esc(best.country) : ""}</div>
          <div class="line">${esc(best.format)}</div>
          <div class="line">Scores <span class="delta">${esc(fmtScore(best.overallScore))}</span> — ${esc(fmtScore(Math.abs(delta)))} ${delta >= 0 ? "above" : "below"} this copy · ${esc(marketLine(best))}${best.inYourCollection ? " · you own it" : ""}</div>
          ${partialSurvey ? `<div class="context" style="margin-top:8px">Partial survey — ${esc(meta.candidatesScored)} of ${esc(meta.candidatesTarget)} pressings scored so far</div>` : ""}
          <div class="actions"><a class="btn" href="${releaseUrl(best.releaseId)}" target="_blank" rel="noreferrer">View on Discogs</a></div>
        </div>`;
    }

    const signals = (d.signals || []).slice(0, 3);
    const whySect = `
      <div class="sect">
        <div class="sect-h">Why</div>
        ${signals.length
          ? `<ul class="why">${signals.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
          : `<div class="meta">${esc(d.whyItScores)}</div>`}
        ${evidenceHtml(d, data.dataCaveats)}
      </div>`;

    $body.innerHTML = `
      ${answer}
      ${enriching ? `<div class="sect" id="enrich-slot">${enrichSlotHtml({ kind: "loading" })}</div>` : betterSect}
      ${whySect}`;
  }

  function renderMaster(data) {
    const a = data.album;
    const rows = (data.topPressings || [])
      .map((p, i) => {
        const lead = i === 0;
        return `
        <a class="row ${lead ? "lead" : ""}" href="${releaseUrl(p.releaseId)}" target="_blank" rel="noreferrer">
          <div class="rank">${esc(p.rank ?? i + 1)}</div>
          <div class="txt">
            <div class="t">${esc(p.year || "")} · ${esc(p.label)} ${esc(p.catno)}</div>
            <div class="s">${esc(p.format)}${p.country ? " · " + esc(p.country) : ""} · ${esc(marketLine(p))}${p.inYourCollection ? " · you own it" : ""}</div>
          </div>
          <div class="num">${esc(fmtScore(p.overallScore))}</div>
        </a>`;
      })
      .join("");

    $body.innerHTML = `
      <div class="sect">
        <div class="sect-h">Best ${esc(data.axis)} pressings</div>
        <div class="context">scored ${esc(a.candidatesScored)} of ${esc(a.totalVersionsSurveyed)} versions${a.originalYear ? ` · original release ${esc(a.originalYear)}` : ""}${data.partial ? " · partial survey, rate-limited — retry in ~60s" : ""}</div>
        <div class="rows">${rows || '<div class="meta">No scorable pressings found.</div>'}</div>
        ${data.note ? `<div class="context" style="margin-top:10px">${esc(data.note)}</div>` : ""}
        ${(data.dataCaveats || []).length ? `<details class="evidence"><summary>Caveats</summary><div class="ev-body">${data.dataCaveats.map((c) => `<div class="ev-note">${esc(c)}</div>`).join("")}</div></details>` : ""}
      </div>`;
  }

  function renderListingIntro({ unresolved = false } = {}) {
    const detail = unresolved
      ? "Couldn’t find this listing’s release link — the page may still be loading. Try again in a moment, or open the release page itself."
      : "Analysis is button-triggered on listings so browsing doesn’t spend your Discogs rate budget.";
    $body.innerHTML = `
      <div class="state">
        <div class="headline">Pressing check</div>
        <div class="detail">${esc(detail)}</div>
        <div class="actions">
          <button class="btn ${unresolved ? "" : "primary"}" data-action="analyze-listing">${unresolved ? "Try again" : "Analyze this pressing"}</button>
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

  function shelfSectHtml(p) {
    const styles = p.dominantStyles
      .slice(0, 5)
      .map((x) => `<b>${esc(x.name)}</b> <span class="pc">${esc(x.share)}%</span>`)
      .join(" · ");
    const user = encodeURIComponent(p.username);
    return `
      <div class="sect">
        <div class="sect-h">${esc(shelfOpinion(p))}</div>
        <div class="stat-line"><b>${esc(p.collectionSize)}</b> in <a href="${DISCOGS}/user/${user}/collection" target="_blank" rel="noreferrer">collection</a> · <b>${esc(p.wantlistSize)}</b> on <a href="${DISCOGS}/wantlist?user=${user}" target="_blank" rel="noreferrer">wantlist</a> · <b>+${esc(p.addedThisMonth)}</b> this month</div>
        ${styles ? `<div class="style-list" style="margin-top:8px">${styles}</div>` : ""}
        ${p.truncated ? '<div class="context" style="margin-top:6px">profiled from your first 3,000 records</div>' : ""}
      </div>`;
  }

  function spinSectHtml(moods) {
    const btns = MOOD_CHIPS.filter((m) => !moods || moods.includes(m))
      .map((m) => `<button data-action="spin" data-mood="${esc(m)}">${esc(m)}</button>`)
      .join("");
    return `
      <div class="sect">
        <div class="sect-h">What to spin tonight</div>
        <div class="moods">${btns}</div>
        <div id="spin-result"></div>
      </div>`;
  }

  function spinPicksHtml(data) {
    return `
      <div class="rows" style="margin-top:10px">
        ${data.picks
          .map(
            (k) => `
          <button class="row" data-action="open-release" data-id="${esc(k.id)}">
            <div class="txt">
              <div class="t">${esc(k.artists.join(", "))} — ${esc(k.title)}</div>
              <div class="s">${esc(k.why)}${k.year ? ` · ${esc(k.year)}` : ""}</div>
            </div>
            ${k.rating ? `<div class="num">${"★".repeat(k.rating)}</div>` : ""}
          </button>`
          )
          .join("")}
      </div>
      <div class="context" style="margin-top:6px">${esc(data.poolSize)} matches on your shelf · tap the mood again to re-roll</div>`;
  }

  function recentAnalysesHtml(items) {
    if (!items?.length) return "";
    return `
      <div class="sect">
        <div class="sect-h">Recently analyzed</div>
        <div class="rows">
          ${items
            .slice(0, 6)
            .map(
              (e) => `
            <button class="row" data-action="open-release" data-id="${esc(e.releaseId)}">
              <div class="txt">
                <div class="t">${esc(e.artist)} — ${esc(e.title)}</div>
                <div class="s">${esc(e.verdict)} · ${esc(e.axis)} · ${esc(fmtAgo(e.ts))}</div>
              </div>
              <div class="num tone-${tone(e)}">${esc(fmtScore(e.score))}</div>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function recentlyAddedHtml(p) {
    if (!p?.recentlyAdded?.length) return "";
    return `
      <div class="sect">
        <div class="sect-h">Recently added to your collection</div>
        <div class="rows">
          ${p.recentlyAdded
            .map(
              (r) => `
            <button class="row" data-action="open-release" data-id="${esc(r.id)}">
              <div class="txt">
                <div class="t">${esc(r.artists.join(", "))} — ${esc(r.title)}</div>
                <div class="s">${esc(r.year || "")}</div>
              </div>
              <div class="when">${esc(r.dateAdded ? fmtDay(r.dateAdded) : "")}</div>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderHome(profile, recent, note) {
    $seg.hidden = true;
    if (profile?.username) setSub(`${profile.username} · connected`);
    const shelf = profile
      ? shelfSectHtml(profile)
      : `
      <div class="sect">
        <div class="sect-h">Your shelf</div>
        <div class="meta">${esc(note || "Shelf profile unavailable right now.")}</div>
        <div class="actions"><button class="btn" data-action="home-retry">Retry</button></div>
      </div>`;
    $body.innerHTML = `
      ${shelf}
      ${spinSectHtml(profile?.moods)}
      ${recentAnalysesHtml(recent)}
      ${recentlyAddedHtml(profile)}`;
  }

  function renderHomeLoading() {
    $seg.hidden = true;
    $body.innerHTML = `
      <div class="sect">
        <div class="progress"><i></i></div>
        <div class="loading-copy">Reading your shelf…</div>
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
    // A full result still owing its survey (rate-limited away) re-enters the
    // enrichment loop like a summary would, instead of ending the flow.
    const isFull = (!res.data.meta || res.data.meta.level === "full") && !res.surveyPending;
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
        <div class="survey-status">
          <span>Surveying pressings</span>
          <div class="progress"><i></i></div>
        </div>`;
    }
    if (state_.kind === "deferred") {
      return `
        <div class="survey-status">
          <span>Rate window cooling — best-pressing survey resumes in <b id="enrich-count">${esc(state_.retryAfter)}</b>s</span>
          <button class="btn quiet" data-action="enrich-now">Retry now</button>
        </div>`;
    }
    if (state_.kind === "ready") {
      return `
        <div class="survey-status">
          <span>Cooldown finished</span>
          <button class="btn" data-action="enrich-now">Survey best pressings</button>
        </div>`;
    }
    return `
      <div class="survey-status">
        <span>${esc(state_.message || "Best-pressing survey unavailable right now.")}</span>
        <button class="btn quiet" data-action="enrich-now">Try again</button>
      </div>`;
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

    if (res?.data && !res.surveyPending) {
      renderRelease(res.data, { listing, stale: !!res.stale });
      return;
    }
    if (res?.needsSetup) { renderSetup(); return; }

    if (res?.data && res.surveyPending) {
      // The verdict came back but the survey was rate-limited away — show
      // what we have and keep the best-pressing slot in the retry loop.
      renderRelease(res.data, { listing, stale: !!res.stale, enriching: true });
    }

    const retryAfter = res?.retryAfter ?? 60;
    if (res?.deferred || res?.rateLimited || res?.surveyPending) {
      setEnrichSlot({ kind: "deferred", retryAfter });
      startCountdown(retryAfter);
      if (autoRetry) {
        // One automatic retry if the same page is still open after cooldown.
        // Jittered past the nominal cooldown: Discogs uses a rolling window,
        // and retrying the moment it half-opens keeps the budget pinned low.
        setTimeout(() => {
          if (seq !== state.seq || state.lastKey !== key) return;
          setEnrichSlot({ kind: "loading" });
          runEnrichment(key, params, seq, listing, { autoRetry: false });
        }, (retryAfter + 15 + Math.random() * 30) * 1000);
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
    setSub("demo · fixture data");
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
