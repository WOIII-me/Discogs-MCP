import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, "openai-plugin", "dig-for-discogs");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const skillPath = path.join(pluginRoot, "skills", "dig-for-discogs", "SKILL.md");
const contractPath = path.join(
  repositoryRoot,
  "docs",
  "openai-submission",
  "phase-1",
  "submission-contract.json",
);
const draftRoot = path.join(repositoryRoot, "docs", "openai-submission", "draft");
const submissionContentPath = path.join(draftRoot, "submission-content.json");

const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

const [manifest, contract, submissionContent, skillText] = await Promise.all([
  readJson(manifestPath),
  readJson(contractPath),
  readJson(submissionContentPath),
  readFile(skillPath, "utf8"),
]);

check(manifest.name === path.basename(pluginRoot), "plugin folder and manifest name must match");
check(/^\d+\.\d+\.\d+$/.test(manifest.version), "plugin version must be strict semver");
check(manifest.description?.length > 20, "plugin description is missing or too short");
check(manifest.author?.name === "WOIII.me", "draft publisher must stay explicit and reviewable");
check(manifest.skills === "./skills/", "plugin must declare its bundled skills directory");
check(!("apps" in manifest), "draft must not declare an app before the app gate is resolved");
check(!("mcpServers" in manifest), "draft must not embed an MCP URL or server configuration");
check(manifest.interface?.displayName === "DIG for Discogs", "display name must be consistent");
check(
  Array.isArray(manifest.interface?.defaultPrompt) &&
    manifest.interface.defaultPrompt.length > 0 &&
    manifest.interface.defaultPrompt.length <= 3,
  "manifest must provide one to three starter prompts",
);
for (const prompt of manifest.interface?.defaultPrompt ?? []) {
  check(typeof prompt === "string" && prompt.length <= 128, "starter prompts must be at most 128 characters");
}

check(skillText.startsWith("---\nname: dig-for-discogs\n"), "skill frontmatter name is invalid");
check(
  /^description: .{80,}$/m.test(skillText),
  "skill description must explain both capability and triggering conditions",
);
check(!/\[TODO:|\bTODO\b/.test(skillText), "skill contains an unresolved TODO marker");

const expectedTools = [
  "search_collection",
  "search_discogs",
  "get_release",
  "get_master_release",
  "get_release_versions",
  "find_best_pressing",
  "compare_pressings",
  "get_collection_stats",
  "get_wantlist",
  "get_recommendations",
];
const toolNames = contract.candidateTools.map(({ name }) => name);
check(contract.contractVersion === "openai-v1", "submission contract version must be openai-v1");
check(contract.status === "conditional", "submission contract must remain conditional before Phase 0 gates");
check(contract.runtimeImpact === "none", "consent-independent artifacts must declare no runtime impact");
check(
  JSON.stringify(toolNames) === JSON.stringify(expectedTools),
  "candidate tool inventory differs from the frozen Phase 1 decision register",
);
check(new Set(toolNames).size === toolNames.length, "candidate tool names must be unique");
check(
  contract.candidateTools.every(({ outputSchema }) => /^[A-Z][A-Za-z]+Output$/.test(outputSchema)),
  "every candidate tool must name an Output schema",
);
check(
  contract.candidateTools.every(({ scope }) => !scope.includes("other-user")),
  "candidate tools must not include other-user scope",
);
check(
  contract.excludedTools.every((name) => !toolNames.includes(name)),
  "excluded and candidate tool inventories overlap",
);

const positive = contract.portalTests?.positive ?? [];
const negative = contract.portalTests?.negative ?? [];
check(positive.length === 5, "portal contract must contain exactly five positive cases");
check(negative.length === 3, "portal contract must contain exactly three negative cases");
check(
  positive.map(({ id }) => id).join(",") === "P1,P2,P3,P4,P5",
  "positive portal case IDs must be P1 through P5",
);
check(
  negative.map(({ id }) => id).join(",") === "N1,N2,N3",
  "negative portal case IDs must be N1 through N3",
);
const schemasByTool = new Map(
  contract.candidateTools.map(({ name, outputSchema }) => [name, outputSchema]),
);
for (const testCase of positive) {
  check(toolNames.includes(testCase.expectedTool), `${testCase.id} selects a non-candidate tool`);
  check(
    schemasByTool.get(testCase.expectedTool) === testCase.expectedOutputSchema,
    `${testCase.id} output schema does not match its tool contract`,
  );
}
for (const testCase of negative) {
  check(testCase.expectedTool === null, `${testCase.id} must not select a tool`);
  check(Boolean(testCase.expectedBoundary), `${testCase.id} must name its safety boundary`);
}

check(submissionContent.schemaVersion === 1, "submission content schema version must be 1");
check(
  submissionContent.status === "conditional-draft",
  "submission content must remain conditional-draft until every gate is closed",
);
check(
  submissionContent.runtimeImpact === "none",
  "submission content preparation must declare no runtime impact",
);
check(
  submissionContent.submissionType === "plugin-with-mcp-and-skills",
  "submission content must describe the intended MCP plus skills submission",
);

const listing = submissionContent.listing ?? {};
check(listing.name === manifest.interface.displayName, "listing and manifest display names differ");
check(listing.publisher === manifest.interface.developerName, "listing and manifest publishers differ");
check(
  listing.shortDescription === manifest.interface.shortDescription,
  "listing and manifest short descriptions differ",
);
check(
  listing.longDescription === manifest.interface.longDescription,
  "listing and manifest long descriptions differ",
);
check(listing.category === manifest.interface.category, "listing and manifest categories differ");
check(listing.websiteUrl === manifest.interface.websiteURL, "listing and manifest website URLs differ");
check(
  listing.privacyPolicyUrl === manifest.interface.privacyPolicyURL,
  "listing and manifest privacy policy URLs differ",
);
check(
  JSON.stringify(submissionContent.starterPrompts) ===
    JSON.stringify(manifest.interface.defaultPrompt),
  "listing and manifest starter prompts differ",
);
check(
  typeof listing.releaseNotes === "string" && listing.releaseNotes.length >= 80,
  "initial release notes are missing or too short",
);

const isHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};
for (const [field, value] of [
  ["websiteUrl", listing.websiteUrl],
  ["privacyPolicyUrl", listing.privacyPolicyUrl],
]) {
  check(isHttpsUrl(value), `listing ${field} must be an absolute HTTPS URL`);
}
check(listing.supportUrl === null, "support URL must remain empty until its owner gate closes");
check(listing.supportEmail === null, "support email must remain empty until its owner gate closes");
check(listing.termsOfServiceUrl === null, "terms URL must remain empty until it is published");
check(listing.logo?.path === null, "production logo path must remain empty until an asset is approved");
check(
  listing.screenshots?.status === "not-applicable-no-component-ui" &&
    listing.screenshots.paths?.length === 0,
  "component screenshots must remain explicitly not applicable for the no-UI draft",
);
check(
  Array.isArray(listing.languages) && listing.languages.join(",") === "en",
  "draft language inventory must remain English-only",
);
check(
  Array.isArray(listing.countries) && listing.countries.length === 0,
  "countries must remain empty until availability is approved",
);

const mcp = submissionContent.mcp ?? {};
check(mcp.serverUrl === null, "MCP server URL must remain empty until the permanent-origin gate closes");
check(mcp.permanentOrigin === null, "permanent origin must remain empty until its owner gate closes");
check(
  mcp.domainVerificationToken === null,
  "domain verification material must never be committed to the conditional draft",
);
check(mcp.authentication?.type === "oauth2", "submission authentication type must be OAuth 2");
check(
  mcp.authentication?.resourceIdentifier === null,
  "OAuth resource identifier must remain empty until the origin gate closes",
);
check(
  JSON.stringify(mcp.authentication?.proposedScopes) === JSON.stringify(["discogs.read"]),
  "draft must propose only the narrow Discogs read scope",
);
check(
  mcp.reviewerAccess?.accountStrategy === null,
  "reviewer account strategy must remain empty until the fixture gate closes",
);
check(
  mcp.reviewerAccess?.credentialsStorage === "portal-only" &&
    mcp.reviewerAccess.credentialsIncludedInRepository === false,
  "reviewer credentials must be portal-only and excluded from the repository",
);
for (const [name, values] of Object.entries(mcp.contentSecurityPolicy ?? {})) {
  if (name === "status") continue;
  check(Array.isArray(values) && values.length === 0, `draft CSP ${name} must remain empty`);
}

const annotations = submissionContent.toolAnnotations ?? [];
check(
  JSON.stringify(annotations.map(({ name }) => name)) === JSON.stringify(toolNames),
  "draft tool annotations differ from the frozen candidate inventory",
);
for (const annotation of annotations) {
  check(annotation.readOnlyHint === true, `${annotation.name} must be annotated read-only`);
  check(annotation.destructiveHint === false, `${annotation.name} must be annotated non-destructive`);
  check(
    annotation.openWorldHint === true,
    `${annotation.name} must declare that it reaches the external Discogs service`,
  );
  check(
    typeof annotation.justification === "string" && annotation.justification.length >= 60,
    `${annotation.name} annotation justification is missing or too short`,
  );
}
check(
  JSON.stringify(submissionContent.portalTestIds?.positive) ===
    JSON.stringify(positive.map(({ id }) => id)),
  "draft positive portal case IDs differ from the Phase 1 contract",
);
check(
  JSON.stringify(submissionContent.portalTestIds?.negative) ===
    JSON.stringify(negative.map(({ id }) => id)),
  "draft negative portal case IDs differ from the Phase 1 contract",
);

const attestations = submissionContent.attestations ?? {};
check(attestations.finalized === false, "conditional draft attestations must not be finalized");
for (const name of [
  "dataUseMatchesPrivacyPolicy",
  "thirdPartyAuthorizationConfirmed",
  "toolAnnotationsVerifiedAgainstProduction",
  "publisherAuthorityConfirmed",
]) {
  check(attestations[name] === null, `conditional attestation ${name} must remain unanswered`);
}

const requiredGateIds = [
  "GATE-DISCOGS-GUIDANCE",
  "GATE-PUBLISHER-VERIFICATION",
  "GATE-PERMANENT-MCP-ORIGIN",
  "GATE-OAUTH-RESOURCE",
  "GATE-PRIVACY-POLICY",
  "GATE-TERMS-URL",
  "GATE-SUPPORT-CONTACT",
  "GATE-REVIEWER-FIXTURE",
  "GATE-AVAILABILITY",
  "GATE-PRODUCTION-LOGO",
];
const gateIds = (submissionContent.gates ?? []).map(({ id }) => id);
check(JSON.stringify(gateIds) === JSON.stringify(requiredGateIds), "submission gate inventory differs");
check(new Set(gateIds).size === gateIds.length, "submission gate IDs must be unique");
for (const gate of submissionContent.gates ?? []) {
  check(gate.state !== "closed", `${gate.id} cannot be closed in a conditional draft`);
  check(typeof gate.owner === "string" && gate.owner.length > 0, `${gate.id} must have an owner`);
  check(Array.isArray(gate.blocks) && gate.blocks.length > 0, `${gate.id} must name what it blocks`);
}

const sources = submissionContent.sourceDocuments ?? [];
check(sources.length >= 5, "submission content must cite the governing source set");
check(sources.some(({ authority }) => authority === "OpenAI"), "OpenAI source evidence is missing");
check(sources.some(({ authority }) => authority === "Discogs"), "Discogs source evidence is missing");
for (const source of sources) {
  check(isHttpsUrl(source.url), `source ${source.title ?? "(untitled)"} must use an absolute HTTPS URL`);
}

check(contract.goldenTests?.length === 12, "golden matrix must contain all twelve Phase 1 cases");
for (const testCase of contract.goldenTests ?? []) {
  check(
    testCase.expectedTool === null || toolNames.includes(testCase.expectedTool),
    `${testCase.id} selects a non-candidate tool`,
  );
  check(
    !testCase.mustNotSelect?.includes(testCase.expectedTool),
    `${testCase.id} both expects and forbids the same tool`,
  );
}

const artifactFiles = [
  ...(await collectFiles(pluginRoot)),
  ...(await collectFiles(draftRoot)),
];
const forbiddenNames = new Set([".mcp.json", ".app.json", ".env", ".dev.vars"]);
for (const filePath of artifactFiles) {
  check(!forbiddenNames.has(path.basename(filePath)), `forbidden draft package file: ${path.basename(filePath)}`);
  const fileStat = await stat(filePath);
  if (fileStat.size > 1_000_000) errors.push(`unexpected large submission artifact: ${path.relative(repositoryRoot, filePath)}`);
  const text = await readFile(filePath, "utf8");
  check(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), `private key material found in ${filePath}`);
  check(!/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/.test(text), `credential-like value found in ${filePath}`);
}

if (errors.length > 0) {
  console.error("OpenAI submission validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `OpenAI submission artifacts valid: ${toolNames.length} candidate tools, ${positive.length} positive cases, ${negative.length} negative cases, ${contract.goldenTests.length} golden cases.`,
  );
}
