import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createJwtAuthVerifier } from "./auth";

describe("JWT authentication", () => {
  it("derives server-trusted caller and subject claims from signed JWTs", async () => {
    const secret = "test-secret-with-at-least-32-bytes";
    const token = await new SignJWT({
      scope: "knowledge-spaces:read knowledge-spaces:write",
      tenant_id: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("knowledge-fs-test")
      .setAudience("knowledge-api")
      .setSubject("user-1")
      .sign(new TextEncoder().encode(secret));
    const verifier = createJwtAuthVerifier({
      audience: "knowledge-api",
      issuer: "knowledge-fs-test",
      secret,
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      callerKind: "interactive",
      subject: {
        scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
        subjectId: "user-1",
        tenantId: "tenant-1",
      },
    });
    await expect(verifier.verify("not-a-token")).resolves.toBeNull();

    const arrayScopesToken = await new SignJWT({
      scopes: ["knowledge-spaces:*"],
      tenantId: "tenant-2",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-2")
      .sign(new TextEncoder().encode(secret));

    await expect(createJwtAuthVerifier({ secret }).verify(arrayScopesToken)).resolves.toEqual({
      callerKind: "interactive",
      subject: {
        scopes: ["knowledge-spaces:*"],
        subjectId: "user-2",
        tenantId: "tenant-2",
      },
    });

    const serviceToken = await new SignJWT({
      caller_kind: "service_api",
      scopes: ["knowledge-spaces:read"],
      tenant_id: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("service-1")
      .sign(new TextEncoder().encode(secret));
    await expect(createJwtAuthVerifier({ secret }).verify(serviceToken)).resolves.toMatchObject({
      callerKind: "service_api",
    });

    const forgedApiKeyChannel = await new SignJWT({
      caller_kind: "api_key",
      scopes: ["knowledge-spaces:*"],
      tenant_id: "tenant-1",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("service-1")
      .sign(new TextEncoder().encode(secret));
    await expect(createJwtAuthVerifier({ secret }).verify(forgedApiKeyChannel)).resolves.toBeNull();

    const missingClaimsToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(secret));

    await expect(createJwtAuthVerifier({ secret }).verify(missingClaimsToken)).resolves.toBeNull();
  });
});
