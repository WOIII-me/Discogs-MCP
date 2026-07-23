import { describe, expect, it, vi } from "vitest";
import {
  evaluatePublicSurfaces,
  inspectPublicSurfaces,
} from "../scripts/check-openai-public-surfaces.mjs";

const siteUrl = "https://woiii.me";

function readySnapshot() {
  const identity = "DIG for Discogs by WOIII.me";
  return {
    siteUrl,
    pages: {
      home: {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<html>${identity}</html>`,
      },
      privacy: {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<html>${identity}. Discogs username, collection, wantlist, and rating data are processed through ChatGPT/OpenAI and hosted by Cloudflare. Cache retention and storage periods are documented. Users can revoke access or request deletion and exercise rights at privacy@woiii.me.</html>`,
      },
      terms: {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<html>${identity}. The service is not affiliated with Discogs.</html>`,
      },
      support: {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<html>${identity}. Contact help@woiii.me. Never share a password, token, secret, or credential.</html>`,
      },
    },
  };
}

describe("OpenAI public-surface preflight", () => {
  it("accepts complete public submission surfaces", () => {
    const report = evaluatePublicSurfaces(readySnapshot());

    expect(report.ready).toBe(true);
    expect(report.checks).toHaveLength(25);
    expect(report.checks.every(({ ok }) => ok)).toBe(true);
  });

  it("reports the current policy, terms, and support gaps", () => {
    const snapshot = readySnapshot();
    snapshot.pages.privacy.body =
      "<html>DIG for Discogs by WOIII.me. ChatGPT processes Discogs collection and wantlist data. Cache periods and revoke controls are described at privacy@woiii.me. DIG collects nothing and data goes nowhere else.</html>";
    snapshot.pages.terms = {
      status: 404,
      contentType: "text/plain; charset=utf-8",
      body: "Not found",
    };
    snapshot.pages.support = {
      status: 404,
      contentType: "text/plain; charset=utf-8",
      body: "Not found",
    };

    const report = evaluatePublicSurfaces(snapshot);
    const failures = report.checks.filter(({ ok }) => !ok).map(({ id }) => id);

    expect(report.ready).toBe(false);
    expect(failures).toEqual([
      "PRIVACY-CLOUDFLARE",
      "PRIVACY-DATA-CATEGORIES",
      "PRIVACY-NO-CONFLICTING-ABSOLUTES",
      "TERMS-HTTP-200",
      "TERMS-HTML",
      "TERMS-IDENTITY",
      "TERMS-DISCOGS",
      "TERMS-NON-AFFILIATION",
      "SUPPORT-HTTP-200",
      "SUPPORT-HTML",
      "SUPPORT-IDENTITY",
      "SUPPORT-CONTACT",
      "SUPPORT-NO-SECRETS",
    ]);
  });

  it("rejects an insecure site origin", () => {
    expect(() =>
      evaluatePublicSurfaces({
        ...readySnapshot(),
        siteUrl: "http://woiii.me",
      }),
    ).toThrow("site URL must use HTTPS");
  });

  it("inspects only the four public GET routes", async () => {
    const snapshot = readySnapshot();
    const responses = new Map<string, Response>(
      Object.entries(snapshot.pages).map(([name, page]) => {
        const path = name === "home" ? "/" : `/${name}`;
        return [
          `${siteUrl}${path}`,
          new Response(page.body, {
            status: page.status,
            headers: { "Content-Type": page.contentType },
          }),
        ];
      }),
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "text/html" });
      const response = responses.get(String(input));
      if (!response) throw new Error(`unexpected URL: ${input}`);
      return response.clone();
    });

    const report = await inspectPublicSurfaces(siteUrl, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.ready).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual(
      [...responses.keys()].sort(),
    );
  });
});
