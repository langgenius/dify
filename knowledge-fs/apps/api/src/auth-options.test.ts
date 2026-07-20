import { describe, expect, it } from "vitest";

import { createApiAuthVerifier } from "./auth-options";

describe("createApiAuthVerifier", () => {
  it("accepts the default local dev token outside production", async () => {
    const verifier = createApiAuthVerifier({ NODE_ENV: "development" });

    await expect(verifier?.verify("dev-token")).resolves.toEqual({
      scopes: ["knowledge-spaces:*"],
      subjectId: "dev-user",
      tenantId: "tenant-dev",
    });
  });

  it("uses explicit local auth subject settings", async () => {
    const verifier = createApiAuthVerifier({
      KNOWLEDGE_DEV_AUTH_TOKEN: "local-secret",
      KNOWLEDGE_DEV_SUBJECT_ID: "subject-1",
      KNOWLEDGE_DEV_TENANT_ID: "tenant-1",
      NODE_ENV: "production",
    });

    await expect(verifier?.verify("local-secret")).resolves.toEqual({
      scopes: ["knowledge-spaces:*"],
      subjectId: "subject-1",
      tenantId: "tenant-1",
    });
  });

  it("does not install implicit auth in production", () => {
    expect(createApiAuthVerifier({ NODE_ENV: "production" })).toBeUndefined();
  });
});
