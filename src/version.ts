import pkg from "../package.json";

/**
 * Single source of truth for the server version: package.json. Surfaced in the
 * MCP handshake, the server_info tool, and the Discogs API User-Agent — bump
 * package.json on release and all three follow.
 */
export const VERSION: string = pkg.version;
