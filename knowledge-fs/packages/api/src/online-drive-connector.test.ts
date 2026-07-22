import { SourceSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  OnlineDriveConnectorConfigError,
  readOnlineDriveSourceConfig,
} from "./online-drive-connector";

function source(type: "connector" | "web", metadata: Record<string, unknown>) {
  return SourceSchema.parse({
    createdAt: "2026-07-03T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata,
    name: "Drive",
    permissionScope: [],
    status: "active",
    type,
    updatedAt: "2026-07-03T00:00:00.000Z",
    uri: "bucket-1",
  });
}

describe("readOnlineDriveSourceConfig", () => {
  it("reads daemon config from a connector source", () => {
    expect(
      readOnlineDriveSourceConfig(
        source("connector", {
          credentials: { key: "s" },
          datasource: "s3_datasource",
          pluginId: "langgenius/s3_datasource",
          provider: "s3_datasource",
        }),
      ),
    ).toEqual({
      credentials: { key: "s" },
      datasource: "s3_datasource",
      pluginId: "langgenius/s3_datasource",
      provider: "s3_datasource",
    });
  });

  it("rejects a non-connector source and missing metadata", () => {
    expect(() => readOnlineDriveSourceConfig(source("web", {}))).toThrow(
      OnlineDriveConnectorConfigError,
    );
    expect(() =>
      readOnlineDriveSourceConfig(source("connector", { pluginId: "x", provider: "y" })),
    ).toThrow(/datasource is required/);
  });
});
