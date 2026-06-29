import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetContext } from "./context.js";
import { jsonResult } from "./context.js";
import { KNOWN_MOODS } from "../../utils/mood-mapping.js";

export function registerPublicTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "ping",
    { description: "Health check. Returns pong and the server time." },
    async () => jsonResult({ status: "pong", time: new Date().toISOString() })
  );

  server.registerTool(
    "auth_status",
    {
      description:
        "Show which Discogs account this MCP session is authenticated as.",
    },
    async () => {
      const ctx = getContext();
      return jsonResult({
        authenticated: true,
        username: ctx.username,
        discogsUserId: ctx.userId,
      });
    }
  );

  server.registerTool(
    "server_info",
    { description: "Server name, version, capabilities, and supported mood keywords." },
    async () =>
      jsonResult({
        name: "discogs",
        project: "WOIII.me · Discogs MCP",
        version: "1.0.0",
        capabilities: [
          "pressing comparison & scoring",
          "collection search with mood mapping",
          "mood/style-based recommendations",
          "cross-user collection discovery",
        ],
        supportedMoods: KNOWN_MOODS,
      })
  );
}
