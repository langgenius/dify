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
      maxKeys: 20,
      operation: "online_drive_browse_files",
      prefix: "docs/",
      source: SOURCE,
      tenantId: "tenant-1",
    });
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
