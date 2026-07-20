import { SourceSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  SourceCredentialConfigError,
  readSourceCredentialConfig,
} from "./source-credential-tester";

function source(metadata: Record<string, unknown>) {
  return SourceSchema.parse({
    createdAt: "2026-07-03T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata,
    name: "S",
    permissionScope: [],
    status: "active",
    type: "web",
    updatedAt: "2026-07-03T00:00:00.000Z",
    uri: "https://example.com",
  });
}

describe("readSourceCredentialConfig", () => {
  it("reads provider identity + credentials, defaulting credentials to {}", () => {
    expect(
      readSourceCredentialConfig(
        source({ credentials: { k: "v" }, pluginId: "langgenius/x", provider: "x" }),
      ),
    ).toEqual({ credentials: { k: "v" }, pluginId: "langgenius/x", provider: "x" });

    expect(
      readSourceCredentialConfig(source({ pluginId: "langgenius/x", provider: "x" })).credentials,
    ).toEqual({});
  });

  it("throws when pluginId or provider is missing", () => {
    expect(() => readSourceCredentialConfig(source({ provider: "x" }))).toThrow(
      SourceCredentialConfigError,
    );
    expect(() => readSourceCredentialConfig(source({ pluginId: "langgenius/x" }))).toThrow(
      /provider is required/,
    );
  });
});
