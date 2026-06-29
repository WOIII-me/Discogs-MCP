import OAuth from "oauth-1.0a";
import { createHmac } from "node:crypto";

export function createOAuthClient(consumerKey: string, consumerSecret: string): OAuth {
  return new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString: string, key: string): string {
      return createHmac("sha1", key).update(baseString).digest("base64");
    },
  });
}

/**
 * Build a signed OAuth 1.0a Authorization header.
 * Extra oauth_* params (e.g. oauth_callback, oauth_verifier) go in `data`
 * so they are included in the signature base string and emitted in the header.
 */
export function getAuthHeader(
  oauth: OAuth,
  url: string,
  method: string,
  token?: { key: string; secret: string },
  data?: Record<string, string>
): string {
  const authData = oauth.authorize({ url, method, data }, token);
  return oauth.toHeader(authData).Authorization;
}
