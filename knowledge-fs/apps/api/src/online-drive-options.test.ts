import type { OnlineDriveBrowseInput } from "@knowledge/api";
import { describe, expect, it } from "vitest";

import type {
  ApiDatasourceInvocationClient,
  ApiDatasourceInvocationInput,
} from "./datasource-invocation-client";
import { createApiOnlineDriveConnector } from "./online-drive-options";

const SOURCE: OnlineDriveBrowseInput["source"] = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    datasource: "s3_datasource",
    pluginId: "langgenius/s3_datasource",
    provider: "s3_datasource",
  },
  name: "Drive",
  permissionScope: [],
  status: "active",
  type: "connector",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "bucket-1",
  version: 1,
};

function b64(text: string): string {
  return Buffer.from(text).toString("base64");
}

function client(
  chunks: readonly unknown[],
  calls: ApiDatasourceInvocationInput[],
): ApiDatasourceInvocationClient {
  return {
    dispatch: (input) => {
      calls.push(input);
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
  };
}

describe("createApiOnlineDriveConnector", () => {
  it("preserves optional remote metadata without trusting malformed hints", async () => {
    const connector = createApiOnlineDriveConnector({
      client: client(
        [
          {
            result: [
              {
                files: [
                  {
                    id: "f1",
                    name: "a.pdf",
                    type: "file",
                    remote_metadata: {
                      version_id: "v1",
                      etag: '"tag-2"',
                      checksum: { algorithm: "md5", value: "a".repeat(32) },
                      modified_time: "2026-09-09T00:00:00Z",
                    },
                  },
                  { id: "f2", name: "b.pdf", type: "file", remote_metadata: "invalid" },
                ],
              },
            ],
          },
        ],
        [],
      ),
    });
    const result = await connector.browse({ source: SOURCE, tenantId: "tenant-1" });
    expect(result.buckets[0]?.files[0]?.remoteMetadata).toEqual({
      version: "v1",
      etag: '"tag-2"',
      checksum: { algorithm: "md5", value: "a".repeat(32) },
      modifiedTime: "2026-09-09T00:00:00.000Z",
    });
    expect(result.buckets[0]?.files[1]).not.toHaveProperty("remoteMetadata");
  });

  it("binds metadata only from the downloaded blob response", async () => {
    const connector = createApiOnlineDriveConnector({
      client: client(
        [
          {
            type: "blob",
            message: { blob: b64("content") },
            meta: {
              file_name: "a.pdf",
              remote_metadata: { version_id: "download-v2", etag: '"tag"' },
            },
          },
        ],
        [],
      ),
    });
    expect(
      await connector.download({ file: { id: "f1" }, source: SOURCE, tenantId: "tenant-1" }),
    ).toMatchObject({ remoteMetadata: { version: "download-v2", etag: '"tag"' } });
  });

  it.each(["complete", "mixed-version", "incomplete"])(
    "checks chunk receipts: %s",
    async (kind) => {
      const first = {
        type: "blob_chunk",
        message: {
          id: "blob-1",
          sequence: 0,
          total_length: 5,
          end: false,
          blob: b64("hel"),
        },
        meta: { remote_metadata: { version_id: "v1" } },
      };
      const last = {
        type: "blob_chunk",
        message: {
          id: "blob-1",
          sequence: 1,
          total_length: 5,
          end: true,
          blob: b64("lo"),
        },
        meta: { remote_metadata: { version_id: kind === "mixed-version" ? "v2" : "v1" } },
      };
      const connector = createApiOnlineDriveConnector({
        client: client(kind === "incomplete" ? [first] : [last, first], []),
      });
      const result = await connector.download({
        file: { id: "f1" },
        source: SOURCE,
        tenantId: "tenant-1",
      });
      if (kind === "complete") expect(result.remoteMetadata).toEqual({ version: "v1" });
      else expect(result).not.toHaveProperty("remoteMetadata");
    },
  );

  it("browses files with the request payload", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const connector = createApiOnlineDriveConnector({
      client: client(
        [
          {
            result: [
              {
                bucket: "b1",
                files: [
                  { id: "f1", name: "a.pdf", size: 10, type: "file" },
                  { id: "d1", name: "docs", type: "folder" },
                ],
                is_truncated: false,
                next_page_parameters: { page_token: "opaque" },
              },
            ],
          },
        ],
        calls,
      ),
    });

    const result = await connector.browse({
      bucket: "b1",
      prefix: "docs/",
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(result.buckets).toEqual([
      {
        bucket: "b1",
        files: [
          { id: "f1", name: "a.pdf", size: 10, type: "file" },
          { id: "d1", name: "docs", type: "folder" },
        ],
        isTruncated: false,
        continuationToken: Buffer.from(JSON.stringify({ page_token: "opaque" }), "utf8").toString(
          "base64url",
        ),
      },
    ]);
    expect(calls[0]).toMatchObject({
      bucket: "b1",
      operation: "online_drive_browse_files",
      prefix: "docs/",
      source: SOURCE,
      tenantId: "tenant-1",
    });
    expect(calls[0]).not.toHaveProperty("maxKeys");
    expect(JSON.stringify(calls[0])).not.toContain("credentials");
  });

  it("downloads a single base64 blob", async () => {
    const connector = createApiOnlineDriveConnector({
      client: client([{ message: { blob: b64("hello world") }, type: "blob" }], []),
    });

    const result = await connector.download({
      file: { bucket: "b1", id: "f1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(Buffer.from(result.body).toString("utf-8")).toBe("hello world");
  });

  it("reassembles out-of-order blob chunks in sequence order", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const connector = createApiOnlineDriveConnector({
      client: client(
        [
          { message: { blob: b64("lo"), end: true, sequence: 1 }, type: "blob_chunk" },
          { message: { blob: b64("hel"), end: false, sequence: 0 }, type: "blob_chunk" },
        ],
        calls,
      ),
    });

    const result = await connector.download({
      file: { id: "f1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(Buffer.from(result.body).toString("utf-8")).toBe("hello");
    expect(calls[0]).toMatchObject({
      file: { id: "f1" },
      operation: "online_drive_download_file",
      source: SOURCE,
      tenantId: "tenant-1",
    });
  });
});
