import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://discogs-mcp.woiii.workers.dev";
export const REQUIRED_SCOPE = "discogs.read";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("base URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("base URL must not contain credentials, a query, or a fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("base URL must be an origin without a path");
  }
  return url.origin;
}

export function parseBearerChallenge(value) {
  if (typeof value !== "string" || !/^Bearer\s/i.test(value)) return null;

  const parameters = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g;
  for (const match of value.matchAll(pattern)) {
    parameters[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return parameters;
}

export function evaluateOAuthContract(snapshot) {
  const checks = [];
  const record = (id, condition, message) => {
    checks.push({ id, ok: Boolean(condition), message });
  };

  const baseUrl = normalizedOrigin(snapshot.baseUrl);
  const resourceIdentifier = `${baseUrl}/mcp`;
  const protectedResourceUrl = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
  const protectedResource = snapshot.protectedResource ?? {};
  const authorizationServer = snapshot.authorizationServer ?? {};
  const unauthorizedMcp = snapshot.unauthorizedMcp ?? {};
  const resourceBody = protectedResource.body ?? {};
  const authorizationBody = authorizationServer.body ?? {};
  const challenge = parseBearerChallenge(unauthorizedMcp.wwwAuthenticate);

  record(
    "PRM-HTTP-200",
    protectedResource.status === 200 && !protectedResource.error,
    "protected-resource metadata returns HTTP 200",
  );
  record(
    "PRM-RESOURCE",
    resourceBody.resource === resourceIdentifier,
    `protected-resource metadata identifies ${resourceIdentifier}`,
  );
  record(
    "PRM-AUTHORIZATION-SERVER",
    asArray(resourceBody.authorization_servers).some(isHttpsUrl),
    "protected-resource metadata names at least one HTTPS authorization server",
  );
  record(
    "PRM-BEARER-HEADER",
    asArray(resourceBody.bearer_methods_supported).includes("header"),
    "protected-resource metadata supports bearer tokens in the Authorization header",
  );
  record(
    "PRM-SCOPE",
    asArray(resourceBody.scopes_supported).includes(REQUIRED_SCOPE),
    `protected-resource metadata advertises ${REQUIRED_SCOPE}`,
  );
  record(
    "PRM-DOCUMENTATION",
    isHttpsUrl(resourceBody.resource_documentation),
    "protected-resource metadata publishes an HTTPS resource_documentation URL",
  );

  record(
    "AS-HTTP-200",
    authorizationServer.status === 200 && !authorizationServer.error,
    "authorization-server metadata returns HTTP 200",
  );
  record(
    "AS-ISSUER",
    isHttpsUrl(authorizationBody.issuer) &&
      asArray(resourceBody.authorization_servers).includes(authorizationBody.issuer),
    "authorization-server issuer is HTTPS and appears in authorization_servers",
  );
  for (const field of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    record(
      `AS-${field.toUpperCase().replaceAll("_", "-")}`,
      isHttpsUrl(authorizationBody[field]),
      `authorization-server metadata publishes an HTTPS ${field}`,
    );
  }
  record(
    "AS-TOKEN-AUTH",
    asArray(authorizationBody.token_endpoint_auth_methods_supported).length > 0,
    "authorization-server metadata declares accepted token endpoint authentication methods",
  );
  record(
    "AS-PKCE-S256",
    asArray(authorizationBody.code_challenge_methods_supported).includes("S256"),
    "authorization-server metadata advertises PKCE S256",
  );
  record(
    "AS-SCOPE",
    asArray(authorizationBody.scopes_supported).includes(REQUIRED_SCOPE),
    `authorization-server metadata advertises ${REQUIRED_SCOPE}`,
  );

  record(
    "MCP-UNAUTHORIZED",
    unauthorizedMcp.status === 401 && !unauthorizedMcp.error,
    "an unauthenticated MCP request returns HTTP 401",
  );
  record("MCP-BEARER-CHALLENGE", challenge !== null, "the 401 response includes a Bearer challenge");
  record(
    "MCP-RESOURCE-METADATA",
    challenge?.resource_metadata === protectedResourceUrl,
    `the Bearer challenge points to ${protectedResourceUrl}`,
  );
  record(
    "MCP-SCOPE",
    challenge?.scope?.split(/\s+/).includes(REQUIRED_SCOPE),
    `the Bearer challenge requests ${REQUIRED_SCOPE}`,
  );

  return {
    baseUrl,
    requiredScope: REQUIRED_SCOPE,
    ready: checks.every(({ ok }) => ok),
    checks,
  };
}

async function fetchSnapshotDocument(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return {
      url,
      status: response.status,
      body,
      wwwAuthenticate: response.headers.get("www-authenticate"),
    };
  } catch (error) {
    return {
      url,
      status: null,
      body: null,
      wwwAuthenticate: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectOAuthContract(
  baseUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {},
) {
  const origin = normalizedOrigin(baseUrl);
  const protectedResourceUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const unauthorizedMcpUrl = `${origin}/mcp`;

  const [protectedResource, unauthorizedMcp] = await Promise.all([
    fetchSnapshotDocument(protectedResourceUrl, fetchImpl, timeoutMs),
    fetchSnapshotDocument(unauthorizedMcpUrl, fetchImpl, timeoutMs),
  ]);
  const advertisedAuthorizationServer = asArray(protectedResource.body?.authorization_servers).find(
    isHttpsUrl,
  );
  const authorizationOrigin = advertisedAuthorizationServer
    ? normalizedOrigin(advertisedAuthorizationServer)
    : origin;
  const authorizationServer = await fetchSnapshotDocument(
    `${authorizationOrigin}/.well-known/oauth-authorization-server`,
    fetchImpl,
    timeoutMs,
  );

  return evaluateOAuthContract({
    baseUrl: origin,
    protectedResource,
    authorizationServer,
    unauthorizedMcp,
  });
}

function parseArguments(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    strict: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--base-url requires a value");
      options.baseUrl = value;
      index += 1;
    } else if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-openai-oauth-contract.mjs [options]

Read-only preflight for the public OAuth metadata and unauthenticated MCP challenge.

Options:
  --base-url <origin>  HTTPS origin to inspect (default: ${DEFAULT_BASE_URL})
  --strict             Exit non-zero when any submission-readiness check fails
  --json               Emit the complete machine-readable report
  -h, --help           Show this help`);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  let report;
  try {
    report = await inspectOAuthContract(options.baseUrl);
  } catch (error) {
    console.error(`OAuth preflight could not start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`OpenAI OAuth preflight: ${report.ready ? "READY" : "NOT READY"}`);
    console.log(`Origin: ${report.baseUrl}`);
    for (const check of report.checks) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id} — ${check.message}`);
    }
    const failed = report.checks.filter(({ ok }) => !ok).length;
    console.log(`${report.checks.length - failed}/${report.checks.length} checks passed; ${failed} gap(s).`);
  }

  if (options.strict && !report.ready) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await main();
