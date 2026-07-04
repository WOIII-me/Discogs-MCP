import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { CachedDiscogsClient } from "./clients/cached-discogs.js";
import { getIdentityWithToken } from "./auth/discogs-oauth.js";
import { registerAllTools } from "./mcp/tools/index.js";
import { registerPrompts } from "./mcp/prompts/index.js";
import { registerResources } from "./mcp/resources/discogs.js";
import type { ToolContext } from "./mcp/tools/context.js";
import type { DiscogsProps, Env } from "./types/env.js";
import { VERSION } from "./version.js";

export class DiscogsMcpAgent extends McpAgent<Env, unknown, DiscogsProps> {
  server = new McpServer({ name: "discogs", version: VERSION });

  async init(): Promise<void> {
    // Local-dev shortcut: when a personal access token is present in the
    // environment (only ever set in .dev.vars), authenticate every request
    // with it and skip OAuth. Never set in production — see types/env.ts.
    const devToken = this.env.DISCOGS_PERSONAL_TOKEN;
    let devIdentity: { username: string; userId: number } | null = null;
    if (devToken) {
      const id = await getIdentityWithToken(devToken);
      devIdentity = { username: id.username, userId: id.id };
    }

    // Tools resolve the per-user Discogs client lazily. In production, props
    // are decrypted from the MCP client's bearer token by the OAuth provider
    // and attached to this agent before any tool call runs.
    const getContext = (): ToolContext => {
      if (devToken && devIdentity) {
        return {
          client: new CachedDiscogsClient({ kind: "token", token: devToken }, this.env.CACHE_KV),
          username: devIdentity.username,
          userId: devIdentity.userId,
        };
      }

      const props = this.props;
      if (!props?.accessToken) {
        throw new Error("Not authenticated with Discogs — complete the OAuth flow first.");
      }
      return {
        client: new CachedDiscogsClient(
          {
            kind: "oauth",
            consumerKey: this.env.DISCOGS_CONSUMER_KEY,
            consumerSecret: this.env.DISCOGS_CONSUMER_SECRET,
            accessToken: props.accessToken,
            accessTokenSecret: props.accessTokenSecret,
          },
          this.env.CACHE_KV
        ),
        username: props.username,
        userId: props.userId,
      };
    };

    registerAllTools(this.server, getContext);
    registerPrompts(this.server);
    registerResources(this.server, getContext);
  }
}
