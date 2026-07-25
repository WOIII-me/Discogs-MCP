import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const EXTENSION_DIR = path.join(scriptDir, "..", "extension");
export const OUTPUT_DIR = path.join(scriptDir, "..", "dist");

/**
 * Paths the packaged extension must always carry, beyond whatever the manifest
 * and the HTML entry points reference:
 * - fixtures/fixtures.js — sidepanel.html loads it unconditionally
 * - fonts/* — Geist ships under SIL OFL 1.1, so the licence travels with it
 */
const REQUIRED_EXTRAS = ["fixtures/fixtures.js", "fonts/Geist-Variable.woff2", "fonts/OFL.txt"];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Local `src="…"` / `href="…"` targets of an HTML entry point. */
function localAssetReferences(html) {
  const references = new Set();
  for (const [, attribute] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(attribute)) continue;
    references.add(attribute.split(/[?#]/)[0]);
  }
  return [...references];
}

/** Files the manifest itself points at. */
function manifestReferences(manifest) {
  const references = [
    manifest?.background?.service_worker,
    manifest?.side_panel?.default_path,
    manifest?.options_ui?.page,
    ...Object.values(manifest?.icons ?? {}),
  ];
  return references.filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * Decide what the release zip contains and whether it is loadable.
 *
 * `files` are POSIX-style paths relative to the extension directory — the zip is
 * rooted there, so `manifest.json` sits at the archive root. Pointing Chrome at a
 * repo-rooted archive is what caused #38: it reports "Manifest file is missing or
 * unreadable" because there is no top-level manifest.
 */
export function planExtensionPackage({ files = [], manifest = {}, html = {} } = {}) {
  const problems = [];
  const entries = [...new Set(files)]
    .filter((file) => !/(?:^|\/)\.DS_Store$/.test(file))
    .sort();
  const present = new Set(entries);

  for (const file of entries) {
    if (file.split("/").some((segment) => segment.startsWith("."))) {
      problems.push(`dotfile must not ship in the package: ${file}`);
    }
  }

  if (!present.has("manifest.json")) {
    problems.push(
      "manifest.json must sit at the archive root — a repo-rooted archive is unloadable (issue #38)",
    );
  }
  for (const file of entries) {
    if (file === "extension" || file.startsWith("extension/")) {
      problems.push(`entries must be rooted at the extension directory, not the repo: ${file}`);
    }
  }

  if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
  if (!manifest.name) problems.push("manifest must declare a name");
  if (!manifest.version) problems.push("manifest must declare a version");

  const required = [...manifestReferences(manifest), ...REQUIRED_EXTRAS];
  for (const [entryPoint, source] of Object.entries(html)) {
    if (!present.has(entryPoint)) continue;
    for (const reference of localAssetReferences(source)) {
      required.push(path.posix.normalize(path.posix.join(path.posix.dirname(entryPoint), reference)));
    }
  }
  for (const reference of [...new Set(required)]) {
    if (!present.has(reference)) problems.push(`referenced file is missing from the package: ${reference}`);
  }

  const slug = slugify(manifest.name ?? "extension");
  return {
    zipName: `${slug || "extension"}-${manifest.version ?? "0.0.0"}.zip`,
    entries,
    problems,
  };
}

function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** Read the extension directory into a `planExtensionPackage` input. */
export function readExtensionSources(extensionDir = EXTENSION_DIR) {
  const files = listFiles(extensionDir);
  const html = {};
  for (const file of files) {
    if (file.endsWith(".html")) html[file] = readFileSync(path.join(extensionDir, file), "utf8");
  }
  return {
    files,
    manifest: JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8")),
    html,
  };
}

/** Build the release zip; returns the plan plus the written archive path. */
export function packageExtension({
  extensionDir = EXTENSION_DIR,
  outputDir = OUTPUT_DIR,
  dryRun = false,
} = {}) {
  const plan = planExtensionPackage(readExtensionSources(extensionDir));
  const zipPath = path.join(outputDir, plan.zipName);
  if (plan.problems.length > 0 || dryRun) return { ...plan, zipPath, written: false };

  mkdirSync(outputDir, { recursive: true });
  rmSync(zipPath, { force: true });
  // Rooted at the extension directory so manifest.json lands at the archive root.
  execFileSync("zip", ["-r", "-X", "-q", zipPath, ".", "-x", "*.DS_Store", ".*", "*/.*"], {
    cwd: extensionDir,
  });
  return { ...plan, zipPath, written: true, bytes: statSync(zipPath).size };
}

function printUsage() {
  console.log(`Usage: node scripts/package-extension.mjs [options]

Build the load-unpacked / Chrome Web Store zip from extension/, rooted so that
manifest.json sits at the archive root.

Options:
  --out <dir>   Output directory (default: dist/)
  --dry-run     Validate the package contents without writing the zip
  -h, --help    Show this help`);
}

function main(argv) {
  const options = { outputDir: OUTPUT_DIR, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("--out requires a value");
      options.outputDir = path.resolve(value);
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      printUsage();
      return;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  const result = packageExtension(options);
  if (result.problems.length > 0) {
    console.error("Extension package is not loadable:");
    for (const problem of result.problems) console.error(`  FAIL ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (result.written) {
    console.log(`Packaged ${result.entries.length} files → ${result.zipPath} (${result.bytes} bytes)`);
  } else {
    console.log(`Package OK (dry run): ${result.entries.length} files → ${result.zipName}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 2;
  }
}
