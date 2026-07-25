import { describe, expect, it } from "vitest";
import {
  planExtensionPackage,
  readExtensionSources,
} from "../scripts/package-extension.mjs";

function loadableSources() {
  return {
    files: [
      "README.md",
      "background.js",
      "fixtures/fixtures.js",
      "fonts/Geist-Variable.woff2",
      "fonts/OFL.txt",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "manifest.json",
      "options.html",
      "options.js",
      "sidepanel.css",
      "sidepanel.html",
      "sidepanel.js",
    ],
    manifest: {
      manifest_version: 3,
      name: "Discogs Copilot",
      version: "0.4.0",
      background: { service_worker: "background.js" },
      side_panel: { default_path: "sidepanel.html" },
      options_ui: { page: "options.html" },
      icons: { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" },
    },
    html: {
      "sidepanel.html":
        '<link rel="stylesheet" href="sidepanel.css"><script src="fixtures/fixtures.js"></script><script src="sidepanel.js"></script>',
      "options.html":
        '<link rel="stylesheet" href="sidepanel.css"><a href="https://www.discogs.com/settings/developers">token</a><script src="options.js"></script>',
    },
  };
}

describe("extension package plan", () => {
  it("accepts a package rooted at the extension directory", () => {
    const plan = planExtensionPackage(loadableSources());

    expect(plan.problems).toEqual([]);
    expect(plan.entries).toContain("manifest.json");
    expect(plan.entries.every((entry) => !entry.startsWith("extension/"))).toBe(true);
  });

  it("rejects a repo-rooted archive — the cause of issue #38", () => {
    const sources = loadableSources();
    sources.files = sources.files.map((file) => `extension/${file}`);

    const plan = planExtensionPackage(sources);

    expect(plan.problems).toContain(
      "manifest.json must sit at the archive root — a repo-rooted archive is unloadable (issue #38)",
    );
    expect(plan.problems).toContain(
      "entries must be rooted at the extension directory, not the repo: extension/manifest.json",
    );
  });

  it("reports files referenced by the manifest or an HTML entry point but not shipped", () => {
    for (const missing of [
      "background.js",
      "icons/icon48.png",
      "sidepanel.css",
      "fixtures/fixtures.js",
      "fonts/OFL.txt",
    ]) {
      const sources = loadableSources();
      sources.files = sources.files.filter((file) => file !== missing);

      expect(planExtensionPackage(sources).problems).toContain(
        `referenced file is missing from the package: ${missing}`,
      );
    }
  });

  it("never ships dotfiles or .DS_Store", () => {
    const sources = loadableSources();
    sources.files.push(".DS_Store", "icons/.DS_Store", ".eslintrc.json");

    const plan = planExtensionPackage(sources);

    expect(plan.entries).not.toContain(".DS_Store");
    expect(plan.entries).not.toContain("icons/.DS_Store");
    expect(plan.problems).toContain("dotfile must not ship in the package: .eslintrc.json");
  });

  it("names the archive from the manifest, so a rename needs no code change", () => {
    expect(planExtensionPackage(loadableSources()).zipName).toBe("discogs-copilot-0.4.0.zip");

    const renamed = loadableSources();
    renamed.manifest.name = "DIG for Discogs";
    renamed.manifest.version = "0.5.0";
    expect(planExtensionPackage(renamed).zipName).toBe("dig-for-discogs-0.5.0.zip");
  });

  it("packages the real extension directory without gaps", () => {
    const plan = planExtensionPackage(readExtensionSources());

    expect(plan.problems).toEqual([]);
    expect(plan.entries).toContain("manifest.json");
    expect(plan.zipName).toMatch(/^[a-z0-9-]+-\d+\.\d+\.\d+\.zip$/);
  });
});
