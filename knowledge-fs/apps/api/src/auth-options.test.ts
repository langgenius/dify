import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createApiAuthVerifier } from "./auth-options";

describe("createApiAuthVerifier", () => {
  it.each(["development", "production"])(
    "accepts Dify-issued workspace JWTs in %s mode",
    async (nodeEnvironment) => {
      const secret = "test-secret-with-at-least-32-bytes";
      const issuedAt = Math.floor(Date.now() / 1_000);
      const token = signJwt(
        {
          caller_kind: "interactive",
          scopes: ["knowledge-spaces:write"],
          tenant_id: "tenant-1",
          aud: "knowledge-fs",
          exp: issuedAt + 60,
          iat: issuedAt,
          iss: "dify",
          sub: "dify-workspace:tenant-1",
        },
        secret,
      );
      const verifier = createApiAuthVerifier({
        KNOWLEDGE_FS_JWT_SECRET: secret,
        NODE_ENV: nodeEnvironment,
      });

      await expect(verifier?.verify(token)).resolves.toEqual({
        callerKind: "interactive",
        subject: {
          scopes: ["knowledge-spaces:write"],
          subjectId: "dify-workspace:tenant-1",
          tenantId: "tenant-1",
        },
      });
    },
  );

  it("keeps explicit local auth available alongside Dify JWT auth", async () => {
    const verifier = createApiAuthVerifier({
      KNOWLEDGE_DEV_AUTH_TOKEN: "local-secret",
      KNOWLEDGE_FS_JWT_SECRET: "test-secret-with-at-least-32-bytes",
      NODE_ENV: "development",
    });

    await expect(verifier?.verify("local-secret")).resolves.toEqual({
      scopes: ["knowledge-spaces:*"],
      subjectId: "dev-user",
      tenantId: "tenant-dev",
    });
  });

  it.each(["development", "test"])(
    "accepts the default local dev token in %s mode",
    async (nodeEnvironment) => {
      const verifier = createApiAuthVerifier({ NODE_ENV: nodeEnvironment });

      await expect(verifier?.verify("dev-token")).resolves.toEqual({
        scopes: ["knowledge-spaces:*"],
        subjectId: "dev-user",
        tenantId: "tenant-dev",
      });
    },
  );

  it("uses explicit local auth subject settings", async () => {
    const verifier = createApiAuthVerifier({
      KNOWLEDGE_DEV_AUTH_TOKEN: "local-secret",
      KNOWLEDGE_DEV_SUBJECT_ID: "subject-1",
      KNOWLEDGE_DEV_TENANT_ID: "tenant-1",
      NODE_ENV: "development",
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

  it("rejects explicit development auth in production", () => {
    expect(
      createApiAuthVerifier({
        KNOWLEDGE_DEV_AUTH_TOKEN: "local-secret",
        NODE_ENV: "production",
      }),
    ).toBeUndefined();
  });

  it.each([undefined, "", "prod", "Production"])(
    "fails closed for an unknown runtime mode: %s",
    (nodeEnvironment) => {
      expect(
        createApiAuthVerifier({
          KNOWLEDGE_DEV_AUTH_TOKEN: "local-secret",
          NODE_ENV: nodeEnvironment,
        }),
      ).toBeUndefined();
    },
  );
});

function signJwt(payload: Readonly<Record<string, unknown>>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${claims}`;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");

  return `${input}.${signature}`;
}
