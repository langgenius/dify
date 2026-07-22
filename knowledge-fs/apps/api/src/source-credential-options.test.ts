import type { SourceCredentialTestInput } from "@knowledge/api";
import { describe, expect, it } from "vitest";

import type {
  ApiDatasourceInvocationClient,
  ApiDatasourceInvocationInput,
} from "./datasource-invocation-client";
import { createApiSourceCredentialTester } from "./source-credential-options";

const SOURCE: SourceCredentialTestInput["source"] = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    credentials: { api_key: "secret" },
    pluginId: "langgenius/firecrawl_datasource",
    provider: "firecrawl",
  },
  name: "Docs",
  permissionScope: [],
  status: "active",
  type: "web",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "https://example.com",
  version: 1,
};

function client(
  behavior: () => AsyncGenerator<unknown>,
  calls: ApiDatasourceInvocationInput[],
): ApiDatasourceInvocationClient {
  return {
    dispatch: (input) => {
      calls.push(input);
      return behavior();
    },
  };
}

describe("createApiSourceCredentialTester", () => {
  it("dispatches validate_credentials and returns the boolean result", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const tester = createApiSourceCredentialTester({
      client: client(async function* () {
        yield { result: true };
      }, calls),
    });

    await expect(tester.test({ source: SOURCE, tenantId: "tenant-1" })).resolves.toEqual({
      valid: true,
    });
    expect(calls[0]).toMatchObject({
      operation: "validate_credentials",
      source: SOURCE,
      tenantId: "tenant-1",
    });
  });

  it("reports invalid config and dispatch failures as { valid: false, error }", async () => {
    const noProvider = createApiSourceCredentialTester({
      client: client(async function* () {}, []),
    });
    await expect(
      noProvider.test({
        source: { ...SOURCE, metadata: { pluginId: "x" } },
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ valid: false });

    const failing = createApiSourceCredentialTester({
      client: client(async function* () {
        yield await Promise.reject(new Error("daemon down"));
      }, []),
    });
    await expect(failing.test({ source: SOURCE, tenantId: "tenant-1" })).resolves.toEqual({
      error: "daemon down",
      valid: false,
    });
  });
});
