import { describe, expect, it, vi } from "vitest";
import {
  evaluateOAuthContract,
  inspectOAuthContract,
  parseBearerChallenge,
} from "../scripts/check-openai-oauth-contract.mjs";

const baseUrl = "https://mcp.woiii.me";
const protectedResourceUrl = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;

function readySnapshot() {
  return {
    baseUrl,
    protectedResource: {
      status: 200,
      body: {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
        scopes_supported: ["discogs.read"],
        resource_documentation: "https://woiii.me/support",
      },
    },
    authorizationServer: {
      status: 200,
      body: {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["discogs.read"],
      },
    },
    unauthorizedMcp: {
      status: 401,
      wwwAuthenticate: `Bearer resource_metadata="${protectedResourceUrl}", scope="discogs.read", error="invalid_token"`,
    },
  };
}

describe("OpenAI OAuth contract preflight", () => {
  it("accepts a submission-ready public metadata contract", () => {
    const report = evaluateOAuthContract(readySnapshot());

    expect(report.ready).toBe(true);
    expect(report.checks).toHaveLength(18);
    expect(report.checks.every(({ ok }) => ok)).toBe(true);
  });

  it("reports the current production metadata gaps without misclassifying valid basics", () => {
    const snapshot = readySnapshot();
    Reflect.deleteProperty(snapshot.protectedResource.body, "scopes_supported");
    Reflect.deleteProperty(snapshot.protectedResource.body, "resource_documentation");
    Reflect.deleteProperty(snapshot.authorizationServer.body, "scopes_supported");
    snapshot.unauthorizedMcp.wwwAuthenticate =
      `Bearer realm="OAuth", resource_metadata="${protectedResourceUrl}", error="invalid_token"`;

    const report = evaluateOAuthContract(snapshot);
    const failures = report.checks.filter(({ ok }) => !ok).map(({ id }) => id);

    expect(report.ready).toBe(false);
    expect(failures).toEqual([
      "PRM-SCOPE",
      "PRM-DOCUMENTATION",
      "AS-SCOPE",
      "MCP-SCOPE",
    ]);
    expect(report.checks.find(({ id }) => id === "AS-PKCE-S256")?.ok).toBe(true);
    expect(report.checks.find(({ id }) => id === "MCP-RESOURCE-METADATA")?.ok).toBe(true);
  });

  it("rejects incorrect identifiers, insecure endpoints, and malformed challenges", () => {
    const snapshot = readySnapshot();
    snapshot.protectedResource.body.resource = baseUrl;
    snapshot.authorizationServer.body.token_endpoint = "http://mcp.woiii.me/token";
    snapshot.authorizationServer.body.code_challenge_methods_supported = ["plain"];
    snapshot.unauthorizedMcp.status = 200;
    snapshot.unauthorizedMcp.wwwAuthenticate = "Basic realm=oauth";

    const report = evaluateOAuthContract(snapshot);
    const failures = report.checks.filter(({ ok }) => !ok).map(({ id }) => id);

    expect(failures).toEqual(
      expect.arrayContaining([
        "PRM-RESOURCE",
        "AS-TOKEN-ENDPOINT",
        "AS-PKCE-S256",
        "MCP-UNAUTHORIZED",
        "MCP-BEARER-CHALLENGE",
        "MCP-RESOURCE-METADATA",
        "MCP-SCOPE",
      ]),
    );
  });

  it("parses quoted and token-style Bearer challenge parameters", () => {
    expect(
      parseBearerChallenge(
        `Bearer realm="OAuth", resource_metadata="${protectedResourceUrl}", scope=discogs.read`,
      ),
    ).toEqual({
      realm: "OAuth",
      resource_metadata: protectedResourceUrl,
      scope: "discogs.read",
    });
    expect(parseBearerChallenge("Basic realm=oauth")).toBeNull();
  });

  it("inspects exactly the two discovery documents and one unauthenticated MCP route", async () => {
    const snapshot = readySnapshot();
    const responses = new Map<string, Response>([
      [
        protectedResourceUrl,
        Response.json(snapshot.protectedResource.body, { status: snapshot.protectedResource.status }),
      ],
      [
        `${baseUrl}/.well-known/oauth-authorization-server`,
        Response.json(snapshot.authorizationServer.body, {
          status: snapshot.authorizationServer.status,
        }),
      ],
      [
        `${baseUrl}/mcp`,
        Response.json(
          { error: "invalid_token" },
          {
            status: snapshot.unauthorizedMcp.status,
            headers: { "WWW-Authenticate": snapshot.unauthorizedMcp.wwwAuthenticate },
          },
        ),
      ],
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      const response = responses.get(String(input));
      if (!response) throw new Error(`unexpected URL: ${input}`);
      return response.clone();
    });

    const report = await inspectOAuthContract(baseUrl, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.ready).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual(
      [...responses.keys()].sort(),
    );
  });
});
