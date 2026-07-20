import type { Source } from "@knowledge/core";

export interface OnlineDriveFile {
  readonly id: string;
  readonly name: string;
  readonly size?: number | undefined;
  /** "folder" or "file". */
  readonly type: string;
}

export interface OnlineDriveBucketListing {
  readonly bucket?: string | undefined;
  /** Opaque provider continuation token; never decode or synthesize it. */
  readonly continuationToken?: string | undefined;
  readonly files: readonly OnlineDriveFile[];
  readonly isTruncated?: boolean | undefined;
}

export interface OnlineDriveBrowseResult {
  readonly buckets: readonly OnlineDriveBucketListing[];
}

export interface OnlineDriveFileRef {
  readonly bucket?: string | undefined;
  readonly id: string;
}

export interface OnlineDriveDownloadResult {
  readonly body: Uint8Array;
}

export interface OnlineDriveBrowseInput {
  readonly bucket?: string | undefined;
  readonly continuationToken?: string | undefined;
  readonly maxKeys?: number | undefined;
  readonly prefix?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export interface OnlineDriveDownloadInput {
  readonly file: OnlineDriveFileRef;
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

/**
 * Connector for online-drive providers (S3, Google Drive, …). The concrete implementation dispatches
 * the plugin-daemon `online_drive_browse_files` / `online_drive_download_file` datasource methods
 * (see apps/api); injected as a gateway option so `@knowledge/api` stays free of the plugin-daemon
 * transport dependency.
 */
export interface OnlineDriveConnector {
  browse(input: OnlineDriveBrowseInput): Promise<OnlineDriveBrowseResult>;
  download(input: OnlineDriveDownloadInput): Promise<OnlineDriveDownloadResult>;
}

export class OnlineDriveConnectorConfigError extends Error {}

export interface OnlineDriveSourceConfig {
  readonly credentials: Record<string, unknown>;
  readonly datasource: string;
  readonly pluginId: string;
  readonly provider: string;
}

export function readOnlineDriveSourceConfig(source: Source): OnlineDriveSourceConfig {
  if (source.type !== "connector") {
    throw new OnlineDriveConnectorConfigError(
      `Source ${source.id} is not an online-drive connector`,
    );
  }

  const metadata = source.metadata;

  return {
    credentials:
      metadata.credentials !== null &&
      typeof metadata.credentials === "object" &&
      !Array.isArray(metadata.credentials)
        ? { ...(metadata.credentials as Record<string, unknown>) }
        : {},
    datasource: requiredString(metadata, "datasource", source.id),
    pluginId: requiredString(metadata, "pluginId", source.id),
    provider: requiredString(metadata, "provider", source.id),
  };
}

function requiredString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  sourceId: string,
): string {
  const value = metadata[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new OnlineDriveConnectorConfigError(
      `Online-drive source ${sourceId} metadata.${key} is required`,
    );
  }

  return value.trim();
}
