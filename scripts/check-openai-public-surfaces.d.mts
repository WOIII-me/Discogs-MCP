export type PublicPageSnapshot = {
  status: number | null;
  contentType?: string | null;
  body?: string;
  error?: string;
};

export type PublicSurfaceSnapshot = {
  siteUrl: string;
  pages: {
    home: PublicPageSnapshot;
    privacy: PublicPageSnapshot;
    terms: PublicPageSnapshot;
    support: PublicPageSnapshot;
  };
};

export type PublicSurfaceCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type PublicSurfaceReport = {
  siteUrl: string;
  ready: boolean;
  checks: PublicSurfaceCheck[];
};

export const DEFAULT_SITE_URL: string;
export function evaluatePublicSurfaces(snapshot: PublicSurfaceSnapshot): PublicSurfaceReport;
export function inspectPublicSurfaces(
  siteUrl: string,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<PublicSurfaceReport>;
