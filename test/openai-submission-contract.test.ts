import { describe, expect, it } from "vitest";
import contract from "../docs/openai-submission/phase-1/submission-contract.json";
import manifest from "../openai-plugin/dig-for-discogs/.codex-plugin/plugin.json";

const candidateNames = contract.candidateTools.map(({ name }) => name);
const schemasByTool = new Map(
  contract.candidateTools.map(({ name, outputSchema }) => [name, outputSchema]),
);

describe("OpenAI submission contract", () => {
  it("preserves every current public endpoint", () => {
    expect(contract.runtimeImpact).toBe("none");
    expect(contract.existingEndpointsPreserved).toEqual(["/mcp", "/sse", "/api/*"]);
  });

  it("freezes the curated ten-tool read-only inventory", () => {
    expect(candidateNames).toEqual([
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
    ]);
    expect(new Set(candidateNames).size).toBe(candidateNames.length);
    expect(contract.candidateTools.every(({ scope }) => !scope.includes("other-user"))).toBe(true);
    expect(contract.excludedTools.some((name) => candidateNames.includes(name))).toBe(false);
  });

  it("keeps operational and cross-user tools outside v1", () => {
    expect(contract.excludedTools).toEqual(
      expect.arrayContaining([
        "ping",
        "auth_status",
        "server_info",
        "explore_user_collection",
        "discover_similar",
      ]),
    );
  });

  it("defines exactly five positive portal cases with matching schemas", () => {
    expect(contract.portalTests.positive.map(({ id }) => id)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    for (const testCase of contract.portalTests.positive) {
      expect(candidateNames).toContain(testCase.expectedTool);
      expect(testCase.expectedOutputSchema).toBe(schemasByTool.get(testCase.expectedTool));
    }
  });

  it("defines exactly three no-tool negative portal cases", () => {
    expect(contract.portalTests.negative.map(({ id }) => id)).toEqual(["N1", "N2", "N3"]);
    for (const testCase of contract.portalTests.negative) {
      expect(testCase.expectedTool).toBeNull();
      expect(testCase.expectedBoundary.length).toBeGreaterThan(0);
    }
  });

  it("turns the complete golden matrix into machine-checkable routing expectations", () => {
    expect(contract.goldenTests.map(({ id }) => id)).toEqual([
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
      "G8",
      "G9",
      "G10",
      "G11",
      "G12",
    ]);
    for (const testCase of contract.goldenTests) {
      if (testCase.expectedTool !== null) expect(candidateNames).toContain(testCase.expectedTool);
      expect(testCase.mustNotSelect).not.toContain(testCase.expectedTool);
    }
    expect(contract.goldenTests.find(({ id }) => id === "G11")).toMatchObject({
      expectedTool: null,
      expectedBoundary: "treat-as-untrusted-data",
    });
  });

  it("keeps the plugin scaffold skill-only until external gates resolve", () => {
    expect(manifest.name).toBe("dig-for-discogs");
    expect(manifest.interface.displayName).toBe("DIG for Discogs");
    expect(manifest).not.toHaveProperty("apps");
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(manifest.interface.defaultPrompt).toHaveLength(3);
  });
});
