export type OAuthSnapshotDocument = {
  status: number | null;
  body?: Record<string, unknown> | null;
  wwwAuthenticate?: string | null;
  error?: string;
};

export type OAuthContractSnapshot = {
  baseUrl: string;
  protectedResource: OAuthSnapshotDocument;
  authorizationServer: OAuthSnapshotDocument;
  unauthorizedMcp: OAuthSnapshotDocument;
};

export type OAuthContractCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type OAuthContractReport = {
  baseUrl: string;
  requiredScope: string;
  ready: boolean;
  checks: OAuthContractCheck[];
};

export const DEFAULT_BASE_URL: string;
export const REQUIRED_SCOPE: string;

export function parseBearerChallenge(value: unknown): Record<string, string> | null;
export function evaluateOAuthContract(snapshot: OAuthContractSnapshot): OAuthContractReport;
export function inspectOAuthContract(
  baseUrl: string,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<OAuthContractReport>;
