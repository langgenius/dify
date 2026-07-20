import { SourceSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  OnlineDocumentConnectorConfigError,
  readOnlineDocumentSourceConfig,
} from "./online-document-connector";

function connectorSource(type: "connector" | "web", metadata: Record<string, unknown>) {
  return SourceSchema.parse({
    createdAt: "2026-07-03T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata,
    name: "Notion",
    permissionScope: [],
    status: "active",
    type,
    updatedAt: "2026-07-03T00:00:00.000Z",
    uri: "workspace-1",
  });
}

describe("readOnlineDocumentSourceConfig", () => {
  it("reads daemon config from a connector source", () => {
    const config = readOnlineDocumentSourceConfig(
      connectorSource("connector", {
        credentials: { integration_secret: "x" },
        datasource: "notion_datasource",
        parameters: { foo: 1 },
        pluginId: "langgenius/notion_datasource",
        provider: "notion_datasource",
      }),
    );

    expect(config).toEqual({
      credentials: { integration_secret: "x" },
      datasource: "notion_datasource",
      parameters: { foo: 1 },
      pluginId: "langgenius/notion_datasource",
      provider: "notion_datasource",
    });
  });

  it("rejects a non-connector source and missing required metadata", () => {
    expect(() =>
      readOnlineDocumentSourceConfig(connectorSource("web", { pluginId: "x" })),
    ).toThrow(OnlineDocumentConnectorConfigError);
    expect(() =>
      readOnlineDocumentSourceConfig(connectorSource("connector", { provider: "notion" })),
    ).toThrow(/datasource is required/);
  });
});
