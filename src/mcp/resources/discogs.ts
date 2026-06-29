import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetContext } from "../tools/context.js";
import { fetchFullCollection, fetchFullWantlist } from "../../utils/collection.js";
import { slimRelease } from "../tools/release-tools.js";

function jsonContents(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function asString(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

export function registerResources(server: McpServer, getContext: GetContext): void {
  server.registerResource(
    "collection",
    "discogs://collection",
    {
      description: "The authenticated user's complete Discogs collection (compact form)",
      mimeType: "application/json",
    },
    async (uri) => {
      const ctx = getContext();
      const collection = await fetchFullCollection(ctx.client, ctx.username);
      return jsonContents(uri, collection);
    }
  );

  server.registerResource(
    "wantlist",
    "discogs://wantlist",
    {
      description: "The authenticated user's complete Discogs wantlist (compact form)",
      mimeType: "application/json",
    },
    async (uri) => {
      const ctx = getContext();
      const wantlist = await fetchFullWantlist(ctx.client, ctx.username);
      return jsonContents(uri, wantlist);
    }
  );

  server.registerResource(
    "release",
    new ResourceTemplate("discogs://release/{id}", { list: undefined }),
    { description: "Details of a Discogs release by ID", mimeType: "application/json" },
    async (uri, variables) => {
      const ctx = getContext();
      const release = await ctx.client.getRelease(Number.parseInt(asString(variables.id), 10));
      return jsonContents(uri, slimRelease(release));
    }
  );

  server.registerResource(
    "master",
    new ResourceTemplate("discogs://master/{id}", { list: undefined }),
    { description: "Details of a Discogs master release by ID", mimeType: "application/json" },
    async (uri, variables) => {
      const ctx = getContext();
      const master = await ctx.client.getMaster(Number.parseInt(asString(variables.id), 10));
      return jsonContents(uri, master);
    }
  );

  server.registerResource(
    "master-versions",
    new ResourceTemplate("discogs://master/{id}/versions", { list: undefined }),
    { description: "First page of pressings/versions of a master release", mimeType: "application/json" },
    async (uri, variables) => {
      const ctx = getContext();
      const versions = await ctx.client.getMasterVersions(
        Number.parseInt(asString(variables.id), 10),
        { per_page: 100 }
      );
      return jsonContents(uri, versions);
    }
  );

  server.registerResource(
    "user-collection",
    new ResourceTemplate("discogs://user/{username}/collection", { list: undefined }),
    { description: "Another user's public collection (compact form)", mimeType: "application/json" },
    async (uri, variables) => {
      const ctx = getContext();
      const collection = await fetchFullCollection(ctx.client, asString(variables.username));
      return jsonContents(uri, collection);
    }
  );

  server.registerResource(
    "user-wantlist",
    new ResourceTemplate("discogs://user/{username}/wants", { list: undefined }),
    { description: "Another user's public wantlist (compact form)", mimeType: "application/json" },
    async (uri, variables) => {
      const ctx = getContext();
      const wantlist = await fetchFullWantlist(ctx.client, asString(variables.username));
      return jsonContents(uri, wantlist);
    }
  );
}
