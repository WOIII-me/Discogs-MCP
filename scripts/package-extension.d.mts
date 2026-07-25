export type ExtensionManifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  background?: { service_worker?: string };
  side_panel?: { default_path?: string };
  options_ui?: { page?: string };
  icons?: Record<string, string>;
};

export type ExtensionSources = {
  /** POSIX paths relative to the extension directory. */
  files: string[];
  manifest: ExtensionManifest;
  /** HTML entry point source keyed by its path, for local asset resolution. */
  html?: Record<string, string>;
};

export type ExtensionPackagePlan = {
  zipName: string;
  entries: string[];
  problems: string[];
};

export type ExtensionPackageResult = ExtensionPackagePlan & {
  zipPath: string;
  written: boolean;
  bytes?: number;
};

export const EXTENSION_DIR: string;
export const OUTPUT_DIR: string;
export function planExtensionPackage(sources?: Partial<ExtensionSources>): ExtensionPackagePlan;
export function readExtensionSources(extensionDir?: string): ExtensionSources;
export function packageExtension(options?: {
  extensionDir?: string;
  outputDir?: string;
  dryRun?: boolean;
}): ExtensionPackageResult;
