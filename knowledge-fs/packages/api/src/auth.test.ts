import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createJwtAuthVerifier, getRequiredScope } from "./auth";

describe("JWT authentication", () => {
  it("classifies the POST batch product projection as read-only", () => {
    expect(getRequiredScope("POST", "/internal/knowledge-spaces/product-summaries/batch")).toBe(
      "knowledge-spaces:read",
    );
  });

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

  it("enforces a configured maximum token lifetime", async () => {
    const secret = "test-secret-with-at-least-32-bytes";
    const issuedAt = Math.floor(Date.now() / 1000);
    const verifier = createJwtAuthVerifier({ maxTtlSeconds: 60, secret });
    const claims = {
      scopes: ["knowledge-spaces:read"],
      tenant_id: "tenant-1",
    };
    const exactLifetimeToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 60)
      .sign(new TextEncoder().encode(secret));
    const overlongToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 61)
      .sign(new TextEncoder().encode(secret));
    const missingIssuedAtToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime(issuedAt + 60)
      .sign(new TextEncoder().encode(secret));
    const missingExpirationToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(issuedAt)
      .sign(new TextEncoder().encode(secret));

    await expect(verifier.verify(exactLifetimeToken)).resolves.toMatchObject({
      subject: { subjectId: "user-1", tenantId: "tenant-1" },
    });
    await expect(verifier.verify(overlongToken)).resolves.toBeNull();
    await expect(verifier.verify(missingIssuedAtToken)).resolves.toBeNull();
    await expect(verifier.verify(missingExpirationToken)).resolves.toBeNull();
    expect(() => createJwtAuthVerifier({ maxTtlSeconds: 0, secret })).toThrow(RangeError);
  });
});
