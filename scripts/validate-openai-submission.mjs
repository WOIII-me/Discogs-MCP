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

const [manifest, contract, skillText] = await Promise.all([
  readJson(manifestPath),
  readJson(contractPath),
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

const pluginFiles = await collectFiles(pluginRoot);
const forbiddenNames = new Set([".mcp.json", ".app.json", ".env", ".dev.vars"]);
for (const filePath of pluginFiles) {
  check(!forbiddenNames.has(path.basename(filePath)), `forbidden draft package file: ${path.basename(filePath)}`);
  const fileStat = await stat(filePath);
  if (fileStat.size > 1_000_000) errors.push(`unexpected large plugin artifact: ${path.relative(pluginRoot, filePath)}`);
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
