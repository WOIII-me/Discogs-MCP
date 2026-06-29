import type { CachedDiscogsClient } from "../../clients/cached-discogs.js";
import { DiscogsApiError, RateLimitError } from "../../clients/discogs.js";

export interface ToolContext {
  client: CachedDiscogsClient;
  username: string;
  userId: number;
}

export type GetContext = () => ToolContext;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Wrap a tool handler so Discogs API failures come back as readable tool errors. */
export function safeTool<A>(
  fn: (args: A) => Promise<ToolResult>
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof RateLimitError) {
        return errorResult(e.message);
      }
      if (e instanceof DiscogsApiError) {
        if (e.status === 404) return errorResult("Not found on Discogs. Check the ID or username.");
        if (e.status === 403) {
          return errorResult(
            "Discogs returned 403 Forbidden — the user's collection or wantlist is likely private."
          );
        }
        if (e.status === 401) {
          return errorResult("Discogs rejected the credentials. Please re-authenticate.");
        }
        return errorResult(e.message);
      }
      return errorResult(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}
