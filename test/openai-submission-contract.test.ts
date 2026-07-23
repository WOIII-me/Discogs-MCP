import { describe, expect, it } from "vitest";
import submissionContent from "../docs/openai-submission/draft/submission-content.json";
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

  it("keeps portal listing copy aligned with the plugin manifest", () => {
    expect(submissionContent.status).toBe("conditional-draft");
    expect(submissionContent.runtimeImpact).toBe("none");
    expect(submissionContent.listing).toMatchObject({
      name: manifest.interface.displayName,
      publisher: manifest.interface.developerName,
      shortDescription: manifest.interface.shortDescription,
      longDescription: manifest.interface.longDescription,
      category: manifest.interface.category,
      websiteUrl: manifest.interface.websiteURL,
      privacyPolicyUrl: manifest.interface.privacyPolicyURL,
    });
    expect(submissionContent.starterPrompts).toEqual(manifest.interface.defaultPrompt);
  });

  it("maps every candidate tool to a conservative read-only annotation", () => {
    expect(submissionContent.toolAnnotations.map(({ name }) => name)).toEqual(candidateNames);
    for (const annotation of submissionContent.toolAnnotations) {
      expect(annotation).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
      expect(annotation.justification.length).toBeGreaterThanOrEqual(60);
    }
  });

  it("references the canonical portal cases without duplicating their prompts", () => {
    expect(submissionContent.portalTestIds.positive).toEqual(
      contract.portalTests.positive.map(({ id }) => id),
    );
    expect(submissionContent.portalTestIds.negative).toEqual(
      contract.portalTests.negative.map(({ id }) => id),
    );
  });

  it("leaves owner-controlled and external values unresolved", () => {
    expect(submissionContent.listing).toMatchObject({
      supportUrl: null,
      supportEmail: null,
      termsOfServiceUrl: null,
      countries: [],
    });
    expect(submissionContent.listing.logo.path).toBeNull();
    expect(submissionContent.mcp).toMatchObject({
      serverUrl: null,
      permanentOrigin: null,
      domainVerificationToken: null,
      authentication: { resourceIdentifier: null },
      reviewerAccess: {
        accountStrategy: null,
        credentialsStorage: "portal-only",
        credentialsIncludedInRepository: false,
      },
    });
    expect(submissionContent.attestations.finalized).toBe(false);
    expect(submissionContent.gates).toHaveLength(10);
    expect(submissionContent.gates.every(({ state }) => state !== "closed")).toBe(true);
  });
});
