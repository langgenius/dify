import {
  type OnlineDriveBrowseResult,
  type OnlineDriveConnector,
  type OnlineDriveFile,
  readOnlineDriveSourceConfig,
} from "@knowledge/api";
import type { PluginDaemonClient } from "@knowledge/plugin-daemon-client";

import { type PluginDaemonClientEnv, createApiPluginDaemonClient } from "./plugin-daemon-options";

const DEFAULT_MAX_KEYS = 20;

/**
 * Online-drive connector backed by the plugin-daemon `online_drive_browse_files` and
 * `online_drive_download_file` datasource methods. Downloaded file bytes arrive as ToolInvokeMessage
 * `blob` / `blob_chunk` messages whose `blob` field is base64-encoded (the JSON-safe binary
 * encoding); chunks are reassembled in sequence order.
 */
export function createApiOnlineDriveConnector(input: {
  readonly client: PluginDaemonClient;
}): OnlineDriveConnector {
  return {
    browse: async ({
      bucket,
      continuationToken,
      maxKeys,
      prefix,
      signal,
      source,
      tenantId,
      userId,
    }) => {
      const config = readOnlineDriveSourceConfig(source);
      const buckets: OnlineDriveBrowseResult["buckets"][number][] = [];

      for await (const raw of input.client.dispatchDatasourceStream({
        data: {
          credentials: config.credentials,
          datasource: config.datasource,
          provider: config.provider,
          request: {
            ...(bucket === undefined ? {} : { bucket }),
            ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
            max_keys: maxKeys ?? DEFAULT_MAX_KEYS,
            prefix: prefix ?? "",
          },
        },
        method: "online_drive_browse_files",
        pluginId: config.pluginId,
        tenantId,
        ...(userId ? { userId } : {}),
        ...(signal ? { signal } : {}),
      })) {
        for (const listing of parseBrowseEnvelope(raw)) {
          buckets.push(listing);
        }
      }

      return { buckets };
    },
    download: async ({ file, signal, source, tenantId, userId }) => {
      const config = readOnlineDriveSourceConfig(source);
      const chunks: { bytes: Uint8Array; sequence: number }[] = [];
      let single: Uint8Array | undefined;

      for await (const raw of input.client.dispatchDatasourceStream({
        data: {
          credentials: config.credentials,
          datasource: config.datasource,
          provider: config.provider,
          request: { bucket: file.bucket ?? "", id: file.id },
        },
        method: "online_drive_download_file",
        pluginId: config.pluginId,
        tenantId,
        ...(userId ? { userId } : {}),
        ...(signal ? { signal } : {}),
      })) {
        const blob = readBlobMessage(raw);

        if (!blob) {
          continue;
        }

        if (blob.sequence === undefined) {
          single = blob.bytes;
        } else {
          chunks.push({ bytes: blob.bytes, sequence: blob.sequence });
        }
      }

      return { body: chunks.length > 0 ? concatChunks(chunks) : (single ?? new Uint8Array()) };
    },
  };
}

export function createApiOnlineDriveOptions(env: PluginDaemonClientEnv = process.env): {
  readonly onlineDriveConnector: OnlineDriveConnector;
} {
  return {
    onlineDriveConnector: createApiOnlineDriveConnector({
      client: createApiPluginDaemonClient(env),
    }),
  };
}

function parseBrowseEnvelope(raw: unknown): OnlineDriveBrowseResult["buckets"][number][] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const result = (raw as Record<string, unknown>).result;

  if (!Array.isArray(result)) {
    return [];
  }

  const listings: OnlineDriveBrowseResult["buckets"][number][] = [];

  for (const item of result) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const files: OnlineDriveFile[] = [];

    if (Array.isArray(record.files)) {
      for (const rawFile of record.files) {
        const file = parseFile(rawFile);

        if (file) {
          files.push(file);
        }
      }
    }

    listings.push({
      files,
      ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
      ...(typeof record.continuation_token === "string"
        ? { continuationToken: record.continuation_token }
        : {}),
      ...(typeof record.is_truncated === "boolean" ? { isTruncated: record.is_truncated } : {}),
    });
  }

  return listings;
}

function parseFile(raw: unknown): OnlineDriveFile | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.id !== "string" || typeof record.name !== "string") {
    return undefined;
  }

  return {
    id: record.id,
    name: record.name,
    ...(typeof record.size === "number" ? { size: record.size } : {}),
    type: typeof record.type === "string" ? record.type : "file",
  };
}

function readBlobMessage(raw: unknown): { bytes: Uint8Array; sequence?: number } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const message = (raw as Record<string, unknown>).message;

  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;

  if (typeof record.blob !== "string") {
    return undefined;
  }

  const bytes = new Uint8Array(Buffer.from(record.blob, "base64"));

  return typeof record.sequence === "number" ? { bytes, sequence: record.sequence } : { bytes };
}

function concatChunks(chunks: { bytes: Uint8Array; sequence: number }[]): Uint8Array {
  const ordered = [...chunks].sort((left, right) => left.sequence - right.sequence);
  const total = ordered.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;

  for (const chunk of ordered) {
    body.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }

  return body;
}
