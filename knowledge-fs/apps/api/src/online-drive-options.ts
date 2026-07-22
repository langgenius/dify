import type {
  OnlineDriveBrowseResult,
  OnlineDriveConnector,
  OnlineDriveFile,
} from "@knowledge/api";

import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";

const DEFAULT_MAX_KEYS = 20;

/**
 * Online-drive connector backed by the deployment-selected datasource runtime. Downloaded file bytes arrive as
 * ToolInvokeMessage
 * `blob` / `blob_chunk` messages whose `blob` field is base64-encoded (the JSON-safe binary
 * encoding); chunks are reassembled in sequence order.
 */
export function createApiOnlineDriveConnector(input: {
  readonly client: ApiDatasourceInvocationClient;
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
      const buckets: OnlineDriveBrowseResult["buckets"][number][] = [];

      for await (const raw of input.client.dispatch({
        ...(bucket === undefined ? {} : { bucket }),
        ...(continuationToken === undefined ? {} : { continuationToken }),
        maxKeys: maxKeys ?? DEFAULT_MAX_KEYS,
        operation: "online_drive_browse_files",
        prefix: prefix ?? "",
        source,
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
      const chunks: { bytes: Uint8Array; sequence: number }[] = [];
      let single: Uint8Array | undefined;

      for await (const raw of input.client.dispatch({
        file,
        operation: "online_drive_download_file",
        source,
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

export function createApiOnlineDriveOptions(input: {
  readonly client: ApiDatasourceInvocationClient;
}): {
  readonly onlineDriveConnector: OnlineDriveConnector;
} {
  return {
    onlineDriveConnector: createApiOnlineDriveConnector(input),
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
      ...continuationToken(record),
      ...(typeof record.is_truncated === "boolean" ? { isTruncated: record.is_truncated } : {}),
    });
  }

  return listings;
}

function continuationToken(record: Readonly<Record<string, unknown>>): {
  readonly continuationToken?: string | undefined;
} {
  if (record.next_page_parameters && typeof record.next_page_parameters === "object") {
    if (!Array.isArray(record.next_page_parameters)) {
      return {
        continuationToken: Buffer.from(
          JSON.stringify(record.next_page_parameters),
          "utf8",
        ).toString("base64url"),
      };
    }
  }
  return typeof record.continuation_token === "string"
    ? { continuationToken: record.continuation_token }
    : {};
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
