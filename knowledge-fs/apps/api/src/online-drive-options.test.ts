import type { OnlineDriveBrowseInput } from "@knowledge/api";
import type {
  PluginDaemonClient,
  PluginDaemonDatasourceInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

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
  calls: PluginDaemonDatasourceInput[],
): PluginDaemonClient {
  return {
    dispatchDatasourceStream: (input) => {
      calls.push(input);
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
    dispatchStream: () => (async function* () {})(),
    dispatchUnary: async () => {
      throw new Error("unused");
    },
  };
}

describe("createApiOnlineDriveConnector", () => {
  it("browses files with the request payload", async () => {
    const calls: PluginDaemonDatasourceInput[] = [];
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
      },
    ]);
    expect(calls[0]).toMatchObject({
      data: {
        datasource: "s3_datasource",
        provider: "s3_datasource",
        request: { bucket: "b1", max_keys: 20, prefix: "docs/" },
      },
      method: "online_drive_browse_files",
      pluginId: "langgenius/s3_datasource",
    });
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
    const calls: PluginDaemonDatasourceInput[] = [];
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
      data: { request: { bucket: "", id: "f1" } },
      method: "online_drive_download_file",
    });
  });
});
