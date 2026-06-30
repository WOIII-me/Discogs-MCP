import type { DiscogsRelease } from "../clients/types.js";

/**
 * Curated audiophile knowledge for judging pressing quality from structured
 * Discogs fields — labels (by id, the reliable key), mastering engineers,
 * pressing/cutting credits, and matrix/runout stamper marks.
 *
 * This encodes the kind of consensus you'd find on the Steve Hoffman forums
 * about which reissue houses and engineers produce great-sounding records,
 * without (yet) scraping those sources. Weights are 0–100 quality bumps.
 */

/** Reputable reissue labels keyed by Discogs label id (most reliable match). */
export const AUDIOPHILE_LABEL_IDS: Record<number, { name: string; weight: number }> = {
  35095: { name: "Mobile Fidelity Sound Lab", weight: 95 },
  57179: { name: "Analogue Productions", weight: 95 },
  22206: { name: "Classic Records", weight: 85 },
};

/**
 * Reputable labels by name (fallback when the id isn't in the table, and to
 * catch sub-labels/series). Matched case-insensitively against label names.
 */
const AUDIOPHILE_LABEL_NAMES: { pattern: RegExp; name: string; weight: number }[] = [
  { pattern: /mobile fidelity|mfsl|mofi/i, name: "Mobile Fidelity", weight: 95 },
  { pattern: /analogue productions/i, name: "Analogue Productions", weight: 95 },
  { pattern: /electric recording co/i, name: "Electric Recording Co.", weight: 95 },
  { pattern: /classic records/i, name: "Classic Records", weight: 85 },
  { pattern: /speakers corner/i, name: "Speakers Corner", weight: 85 },
  { pattern: /impex records?/i, name: "Impex", weight: 85 },
  { pattern: /original recordings group|^org\b/i, name: "ORG", weight: 80 },
  { pattern: /pure pleasure/i, name: "Pure Pleasure", weight: 80 },
  { pattern: /intervention records/i, name: "Intervention", weight: 80 },
  { pattern: /music matters/i, name: "Music Matters", weight: 85 },
  { pattern: /tone poet/i, name: "Blue Note Tone Poet", weight: 90 },
  { pattern: /acoustic sounds/i, name: "Acoustic Sounds Series", weight: 85 },
  { pattern: /audio fidelity/i, name: "Audio Fidelity", weight: 75 },
  { pattern: /\bdcc\b|dcc compact/i, name: "DCC", weight: 85 },
  { pattern: /nautilus/i, name: "Nautilus", weight: 75 },
];

/** Mastering / cutting engineers with strong audiophile reputations. */
const RENOWNED_ENGINEERS: { pattern: RegExp; name: string }[] = [
  { pattern: /kevin\s*gray/i, name: "Kevin Gray" },
  { pattern: /bernie\s*grundman/i, name: "Bernie Grundman" },
  { pattern: /bob\s*ludwig/i, name: "Bob Ludwig" },
  { pattern: /steve\s*hoffman/i, name: "Steve Hoffman" },
  { pattern: /doug\s*sax/i, name: "Doug Sax" },
  { pattern: /george\s*marino/i, name: "George Marino" },
  { pattern: /ryan\s*k?\.?\s*smith/i, name: "Ryan K. Smith" },
  { pattern: /chris\s*bellman/i, name: "Chris Bellman" },
  { pattern: /stan\s*ricker/i, name: "Stan Ricker" },
  { pattern: /krieg\s*wunderlich/i, name: "Krieg Wunderlich" },
  { pattern: /rudy\s*van\s*gelder|\brvg\b/i, name: "Rudy Van Gelder" },
  { pattern: /barry\s*diament/i, name: "Barry Diament" },
  { pattern: /willem\s*makkee/i, name: "Willem Makkee" },
];

const MASTERING_ROLE = /master|lacquer|cut by|cut at|transfer|remaster/i;

/** Reputable cutting/pressing studios that appear in the companies list. */
const REPUTABLE_STUDIOS = /sterling sound|abbey road|bernie grundman|cohearent|the mastering lab|gateway|rti|quality record pressings|qrp|pallas|optimal|record technology/i;

/** Matrix/runout marks that signal a desirable pressing. */
const STAMPER_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /van\s*gelder|\brvg\b/i, label: "RVG stamp (Van Gelder)" },
  { pattern: /sterling|\bst\b/i, label: "Sterling Sound stamp" },
  { pattern: /masterdisk|\bmd\b/i, label: "Masterdisk stamp" },
  { pattern: /bell sound/i, label: "Bell Sound" },
  { pattern: /\bkg\b|kevin gray/i, label: "Kevin Gray initials" },
  { pattern: /\bbg\b/i, label: "Bernie Grundman initials" },
];

export interface ReputationSignal {
  label: string; // human-readable, for provenance
  weight: number; // contribution toward the pedigree score
}

/** Structured breakdown of the reputation evidence, for dossiers/UI. */
export interface ReputationDetail {
  label?: { id?: number; name: string; weight: number };
  engineers: string[];
  stampers: string[];
  studio?: string;
  formatCues: string[];
}

export interface ReputationResult {
  /** 0–100 pedigree score from labels/engineers/credits/stampers. */
  score: number;
  /** 0–1: how much explicit evidence we actually found (drives factor confidence). */
  confidence: number;
  signals: string[]; // provenance, e.g. "Mobile Fidelity (label)", "Mastered by Kevin Gray"
  /** Structured form of the same evidence in `signals`, for clients that want fields. */
  detail: ReputationDetail;
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

/** Detect audiophile-label / renowned-engineer signals from a master version row. */
export function versionLooksAudiophile(label: string, format: string): boolean {
  const blob = `${label} ${format}`;
  if (AUDIOPHILE_LABEL_NAMES.some((l) => l.pattern.test(blob))) return true;
  // Format-level cues that almost always mean an audiophile reissue
  return /\bsacd\b|45\s*rpm|uhqr|180\s*g|half[- ]?speed/i.test(blob);
}

/**
 * Score a release's mastering/pressing pedigree from structured fields.
 * Combines: reputable label (by id, then name), renowned engineer credits,
 * the mere presence of explicit mastering credits, reputable studios, and
 * matrix/runout stamper marks. Notes text is used only as a weak fallback.
 */
export function scoreReputation(release: DiscogsRelease): ReputationResult {
  const signals: string[] = [];
  const detail: ReputationDetail = { engineers: [], stampers: [], formatCues: [] };
  let score = 0;
  let evidencePoints = 0; // raw evidence found, mapped to confidence below

  // --- Label reputation (by id first, then name) ---
  let labelWeight = 0;
  for (const lbl of release.labels ?? []) {
    const byId = lbl.id ? AUDIOPHILE_LABEL_IDS[lbl.id] : undefined;
    const byName = AUDIOPHILE_LABEL_NAMES.find((l) => l.pattern.test(lbl.name ?? ""));
    const hit = byId ?? byName;
    if (hit && hit.weight > labelWeight) {
      labelWeight = hit.weight;
      signals.push(`${hit.name} (reissue label)`);
      detail.label = { id: lbl.id, name: hit.name, weight: hit.weight };
    }
  }
  if (labelWeight > 0) {
    score += labelWeight * 0.6; // label is the strongest single cue
    evidencePoints += 2;
  }

  // --- Mastering / cutting credits (extraartists) ---
  const masteringCredits = (release.extraartists ?? []).filter((c) => MASTERING_ROLE.test(c.role));
  if (masteringCredits.length > 0) {
    score += 10; // an explicit mastering credit at all is a small positive
    evidencePoints += 1;
  }
  const engineerNames = uniq(
    masteringCredits
      .map((c) => RENOWNED_ENGINEERS.find((e) => e.pattern.test(c.name))?.name)
      .filter((n): n is string => Boolean(n))
  );
  detail.engineers = engineerNames;
  for (const name of engineerNames) {
    score += 20;
    signals.push(`Mastered/cut by ${name}`);
    evidencePoints += 2;
  }

  // --- Reputable pressing/cutting studios (companies) ---
  const studio = (release.companies ?? []).find((c) =>
    REPUTABLE_STUDIOS.test(`${c.name} ${c.entity_type_name ?? ""}`)
  );
  if (studio) {
    score += 10;
    signals.push(`${studio.name} (${studio.entity_type_name ?? "studio"})`);
    detail.studio = studio.name;
    evidencePoints += 1;
  }

  // --- Matrix / runout stamper marks ---
  const runouts = (release.identifiers ?? [])
    .filter((i) => /matrix|runout/i.test(i.type))
    .map((i) => i.value)
    .join(" ");
  for (const s of STAMPER_SIGNALS) {
    if (s.pattern.test(runouts)) {
      score += 8;
      signals.push(s.label);
      detail.stampers.push(s.label);
      evidencePoints += 1;
    }
  }
  // First-stamper marks like "...-1A"/"-1B" hint at an early, well-cut pressing
  if (/-\s*1[A-D]\b/.test(runouts)) {
    score += 6;
    signals.push("Early stamper (matrix …-1x)");
    detail.stampers.push("Early stamper (matrix …-1x)");
    evidencePoints += 1;
  }

  // --- Format-borne audiophile cues (half-speed, AAA, SACD, 45rpm, 180g) ---
  const fmt = (release.formats ?? [])
    .map((f) => [f.name, ...(f.descriptions ?? [])].join(" "))
    .join(" ");
  const fmtCues: { pattern: RegExp; pts: number; label: string }[] = [
    { pattern: /uhqr/i, pts: 15, label: "UHQR" },
    { pattern: /half[- ]?speed/i, pts: 15, label: "Half-speed master" },
    { pattern: /all[- ]?analog|\baaa\b/i, pts: 12, label: "All-analog (AAA)" },
    { pattern: /\bsacd\b/i, pts: 10, label: "SACD layer" },
    { pattern: /45\s*rpm/i, pts: 8, label: "45 RPM cut" },
    { pattern: /180\s*g/i, pts: 5, label: "180 gram" },
  ];
  for (const c of fmtCues) {
    if (c.pattern.test(fmt)) {
      score += c.pts;
      signals.push(c.label);
      detail.formatCues.push(c.label);
      evidencePoints += 1;
    }
  }

  // --- Weak fallback: notes text (only nudges, never dominates) ---
  if (labelWeight === 0 && engineerNames.length === 0) {
    if (/audiophile|original\s*master|first\s*press/i.test(release.notes ?? "")) {
      score += 8;
      signals.push("Audiophile cue in notes");
      evidencePoints += 1;
    }
  }

  return {
    score: Math.min(Math.round(score), 100),
    confidence: Math.min(evidencePoints / 4, 1), // saturates once we have solid evidence
    signals: uniq(signals),
    detail,
  };
}

/** Extract readable mastering credits for the tool output. */
export function masteringCredits(release: DiscogsRelease): string[] {
  return uniq(
    (release.extraartists ?? [])
      .filter((c) => MASTERING_ROLE.test(c.role))
      .map((c) => `${c.name} — ${c.role}`)
  );
}
