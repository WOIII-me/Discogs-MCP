import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetContext } from "./context.js";
import { registerPublicTools } from "./public.js";
import { registerSearchTools } from "./search-tools.js";
import { registerReleaseTools } from "./release-tools.js";
import { registerPressingTools } from "./pressing-tools.js";
import { registerCollectionTools } from "./collection-tools.js";
import { registerWantlistTools } from "./wantlist-tools.js";
import { registerRecommendationTools } from "./recommendation-tools.js";

export function registerAllTools(server: McpServer, getContext: GetContext): void {
  registerPublicTools(server, getContext);
  registerSearchTools(server, getContext);
  registerReleaseTools(server, getContext);
  registerPressingTools(server, getContext);
  registerCollectionTools(server, getContext);
  registerWantlistTools(server, getContext);
  registerRecommendationTools(server, getContext);
}
