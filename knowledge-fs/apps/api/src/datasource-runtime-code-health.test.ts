import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const INTEGRATED_DATASOURCE_FILES = [
  "datasource-invocation-client.ts",
  "dify-datasource-invocation-client.ts",
  "dify-datasource-runtime-options.ts",
  "online-document-options.ts",
  "online-drive-options.ts",
  "source-credential-options.ts",
  "website-crawl-options.ts",
] as const;

describe("KnowledgeFS datasource-runtime architecture", () => {
  it("keeps integrated connectors behind Dify and out of plugin-daemon request assembly", () => {
    for (const file of INTEGRATED_DATASOURCE_FILES) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");

      expect(source, file).not.toContain("@knowledge/plugin-daemon-client");
      expect(source, file).not.toMatch(/\bcredentials\s*:/u);
      expect(source, file).not.toContain("dispatchDatasourceStream");
    }
  });

  it("isolates direct plugin-daemon credentials to the standalone adapter", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "standalone-datasource-invocation-client.ts"),
      "utf8",
    );

    expect(source).toContain("@knowledge/plugin-daemon-client");
    expect(source).toMatch(/\bcredentials\s*:/u);
    expect(source).toContain("dispatchDatasourceStream");
  });

  it("keeps the Dify wire contract credential-reference-only", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../packages/dify-datasource-runtime-client/src/index.ts"),
      "utf8",
    );

    expect(source).toContain("credential_id");
    expect(source).not.toMatch(/\bcredentials\s*:/u);
    expect(source).not.toContain("@knowledge/plugin-daemon-client");
  });

  it("assembles Dify credential ownership whenever integrated mode is enabled", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");

    expect(source).toContain("createApiDatasourceInvocationClient");
    expect(source).toMatch(/credentialMode:\s*integratedModeEnabled\s*\?\s*"dify-managed"/u);
    expect(source).toMatch(/inlineSourceCredentialsAllowed:\s*!integratedModeEnabled/u);
    expect(source).toMatch(
      /integratedModeEnabled\s*\?\s*undefined\s*:\s*createApiSourceSecretStore/u,
    );
    expect(source).toMatch(
      /sourceOAuthOptions\s*=\s*integratedModeEnabled\s*\?[^:]+providerIds:\s*new Set<string>\(\)/su,
    );
    expect(source).toMatch(
      /sourceCredentialBackfill\s*=\s*integratedModeEnabled\s*\?\s*undefined/u,
    );
    expect(source).toMatch(/!integratedModeEnabled\s*&&\s*sourceSecretStore/u);
  });
});
