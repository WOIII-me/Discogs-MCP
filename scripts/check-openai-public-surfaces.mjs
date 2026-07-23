import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_SITE_URL = "https://woiii.me";

function normalizedOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("site URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("site URL must not contain credentials, a query, or a fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("site URL must be an origin without a path");
  }
  return url.origin;
}

function normalizedBody(page) {
  return typeof page?.body === "string" ? page.body.toLowerCase() : "";
}

function isHtml(page) {
  return typeof page?.contentType === "string" && page.contentType.toLowerCase().includes("text/html");
}

function hasProjectIdentity(body) {
  return body.includes("dig for discogs") && body.includes("woiii.me");
}

export function evaluatePublicSurfaces(snapshot) {
  const checks = [];
  const record = (id, condition, message) => {
    checks.push({ id, ok: Boolean(condition), message });
  };

  const siteUrl = normalizedOrigin(snapshot.siteUrl);
  const home = snapshot.pages?.home ?? {};
  const privacy = snapshot.pages?.privacy ?? {};
  const terms = snapshot.pages?.terms ?? {};
  const support = snapshot.pages?.support ?? {};
  const homeBody = normalizedBody(home);
  const privacyBody = normalizedBody(privacy);
  const termsBody = normalizedBody(terms);
  const supportBody = normalizedBody(support);

  record("SITE-HTTP-200", home.status === 200 && !home.error, "website returns HTTP 200");
  record("SITE-HTML", isHtml(home), "website returns HTML");
  record("SITE-PRODUCT", homeBody.includes("dig for discogs"), "website identifies DIG for Discogs");
  record("SITE-PUBLISHER", homeBody.includes("woiii.me"), "website identifies WOIII.me");

  record(
    "PRIVACY-HTTP-200",
    privacy.status === 200 && !privacy.error,
    "privacy policy returns HTTP 200",
  );
  record("PRIVACY-HTML", isHtml(privacy), "privacy policy returns HTML");
  record("PRIVACY-IDENTITY", hasProjectIdentity(privacyBody), "privacy policy identifies product and publisher");
  record("PRIVACY-DISCOGS", privacyBody.includes("discogs"), "privacy policy identifies Discogs as the data source");
  record(
    "PRIVACY-OPENAI",
    privacyBody.includes("openai") || privacyBody.includes("chatgpt"),
    "privacy policy identifies OpenAI or ChatGPT as a recipient/processor",
  );
  record(
    "PRIVACY-CLOUDFLARE",
    privacyBody.includes("cloudflare"),
    "privacy policy identifies Cloudflare as infrastructure/processor",
  );
  record(
    "PRIVACY-DATA-CATEGORIES",
    ["username", "collection", "wantlist", "rating"].every((term) => privacyBody.includes(term)),
    "privacy policy identifies username, collection, wantlist, and rating data categories",
  );
  record(
    "PRIVACY-RETENTION",
    /retain|retention|cache|stored|storage/.test(privacyBody),
    "privacy policy describes storage or retention",
  );
  record(
    "PRIVACY-CONTROLS",
    /delete|deletion|unlink|revoke|rights/.test(privacyBody),
    "privacy policy describes user controls or data rights",
  );
  record(
    "PRIVACY-CONTACT",
    /[a-z0-9._%+-]+@woiii\.me/.test(privacyBody),
    "privacy policy provides a WOIII.me contact address",
  );
  record(
    "PRIVACY-NO-CONFLICTING-ABSOLUTES",
    !/collects?\s+nothing|no\s+data\s+collection|no\s+sharing|nowhere\s+else/.test(privacyBody),
    "privacy policy avoids absolute no-collection/no-sharing claims that conflict with the data flow",
  );

  record("TERMS-HTTP-200", terms.status === 200 && !terms.error, "terms return HTTP 200");
  record("TERMS-HTML", isHtml(terms), "terms return HTML");
  record("TERMS-IDENTITY", hasProjectIdentity(termsBody), "terms identify product and publisher");
  record("TERMS-DISCOGS", termsBody.includes("discogs"), "terms identify the Discogs dependency");
  record(
    "TERMS-NON-AFFILIATION",
    termsBody.includes("not affiliated") && termsBody.includes("discogs"),
    "terms include a Discogs non-affiliation statement",
  );

  record("SUPPORT-HTTP-200", support.status === 200 && !support.error, "support page returns HTTP 200");
  record("SUPPORT-HTML", isHtml(support), "support page returns HTML");
  record("SUPPORT-IDENTITY", hasProjectIdentity(supportBody), "support page identifies product and publisher");
  record(
    "SUPPORT-CONTACT",
    /[a-z0-9._%+-]+@woiii\.me/.test(supportBody),
    "support page provides a WOIII.me contact address",
  );
  record(
    "SUPPORT-NO-SECRETS",
    /do not|don't|never|avoid/.test(supportBody) &&
      /password|token|secret|credential/.test(supportBody),
    "support page tells users not to submit passwords, tokens, secrets, or credentials",
  );

  return {
    siteUrl,
    ready: checks.every(({ ok }) => ok),
    checks,
  };
}

async function fetchPage(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/html" },
    });
    const body = (await response.text()).slice(0, 1_000_000);
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body,
    };
  } catch (error) {
    return {
      url,
      status: null,
      contentType: null,
      body: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectPublicSurfaces(
  siteUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {},
) {
  const origin = normalizedOrigin(siteUrl);
  const routes = {
    home: "/",
    privacy: "/privacy",
    terms: "/terms",
    support: "/support",
  };
  const entries = await Promise.all(
    Object.entries(routes).map(async ([name, path]) => [
      name,
      await fetchPage(`${origin}${path}`, fetchImpl, timeoutMs),
    ]),
  );

  return evaluatePublicSurfaces({
    siteUrl: origin,
    pages: Object.fromEntries(entries),
  });
}

function parseArguments(argv) {
  const options = {
    siteUrl: DEFAULT_SITE_URL,
    strict: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--site-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--site-url requires a value");
      options.siteUrl = value;
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
  console.log(`Usage: node scripts/check-openai-public-surfaces.mjs [options]

Read-only preflight for the website, privacy, terms, and support routes.

Options:
  --site-url <origin>  HTTPS website origin to inspect (default: ${DEFAULT_SITE_URL})
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
    report = await inspectPublicSurfaces(options.siteUrl);
  } catch (error) {
    console.error(`Public-surface preflight could not start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`OpenAI public-surface preflight: ${report.ready ? "READY" : "NOT READY"}`);
    console.log(`Site: ${report.siteUrl}`);
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
