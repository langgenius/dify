import { readFileSync } from "node:fs";

import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";

import {
  type DifyCapabilityV2Claims,
  type DifyCapabilityV2PublicJwk,
  createDifyCapabilityV2RequestGuard,
  createDifyCapabilityV2Verifier,
  createStaticDifyCapabilityV2JwksProvider,
} from "./dify-capability-v2";

interface DifyCapabilityV2AuthProfile {
  readonly active: boolean;
  readonly audience: string;
  readonly callerProfiles: Readonly<
    Record<string, { readonly authorizedParty: string; readonly subjectPrefix: string }>
  >;
  readonly claimBindings: {
    readonly action: string;
    readonly callerKind: string;
    readonly controlSpace: string;
    readonly namespace: string;
    readonly resource: string;
    readonly resourceParent: string;
    readonly subject: string;
  };
  readonly issuer: string;
  readonly lifecycle: string;
  readonly maxTtlSeconds: number;
  readonly productionReady: boolean;
  readonly profileId: string;
  readonly protectedHeader: {
    readonly algorithm: string;
    readonly keyIdClaim: string;
    readonly keyIdRequired: boolean;
    readonly type: string;
  };
  readonly requiredClaims: readonly string[];
  readonly schemaVersion: number;
  readonly signatureAlgorithms: readonly string[];
}

interface DifyCapabilityV2TestVector {
  readonly algorithm: string;
  readonly audience: string;
  readonly expectedClaims: DifyCapabilityV2Claims;
  readonly expectedPrincipal: {
    readonly callerKind: string;
    readonly subject: {
      readonly scopes: readonly string[];
      readonly subjectId: string;
      readonly tenantId: string;
    };
  };
  readonly issuer: string;
  readonly operation: {
    readonly action: string;
    readonly method: string;
    readonly operationId: string;
    readonly requestPath: string;
  };
  readonly profileId: string;
  readonly protectedHeader: {
    readonly alg: string;
    readonly kid: string;
    readonly typ: string;
  };
  readonly publicJwk: DifyCapabilityV2PublicJwk;
  readonly schemaVersion: number;
  readonly testOnly: boolean;
  readonly token: string;
  readonly ttlSeconds: number;
}

const capabilityV2Vector = JSON.parse(
  readFileSync(
    new URL("../../../contracts/dify-capability-v2-test-vector.json", import.meta.url),
    "utf8",
  ),
) as DifyCapabilityV2TestVector;
const capabilityV2Profile = JSON.parse(
  readFileSync(
    new URL("../../../contracts/dify-capability-v2-auth-profile.json", import.meta.url),
    "utf8",
  ),
) as DifyCapabilityV2AuthProfile;

describe("Dify Capability v2 production authentication contract", () => {
  it("makes RS256 Capability v2 the only production authentication profile", () => {
    expect(capabilityV2Profile).toMatchObject({
      active: true,
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      lifecycle: "active",
      maxTtlSeconds: 60,
      productionReady: true,
      profileId: "dify-capability-v2",
      protectedHeader: {
        algorithm: "RS256",
        keyIdClaim: "kid",
        keyIdRequired: true,
        type: "JWT",
      },
      schemaVersion: 3,
      signatureAlgorithms: ["RS256"],
    });
    expect(capabilityV2Profile.claimBindings).toEqual({
      action: "action",
      callerKind: "caller_kind",
      controlSpace: "control_space_id",
      namespace: "namespace_id",
      resource: "resource",
      resourceParent: "resource.parent_id",
      subject: "sub",
    });
    expect(capabilityV2Profile.callerProfiles.interactive).toEqual({
      authorizedParty: "dify-console",
      subjectPrefix: "dify-account:",
    });
  });

  it("verifies the deterministic Dify-issued token and its exact operation/resource binding", async () => {
    expect(capabilityV2Vector).toMatchObject({
      algorithm: "RS256",
      audience: capabilityV2Profile.audience,
      issuer: capabilityV2Profile.issuer,
      profileId: capabilityV2Profile.profileId,
      schemaVersion: 2,
      testOnly: true,
      ttlSeconds: capabilityV2Profile.maxTtlSeconds,
    });
    expect(decodeProtectedHeader(capabilityV2Vector.token)).toEqual(
      capabilityV2Vector.protectedHeader,
    );
    expect(capabilityV2Vector.protectedHeader.kid).toBe(capabilityV2Vector.publicJwk.kid);
    expect(decodeJwt(capabilityV2Vector.token)).toEqual(capabilityV2Vector.expectedClaims);
    expect(Object.keys(capabilityV2Vector.expectedClaims).sort()).toEqual(
      [...capabilityV2Profile.requiredClaims].sort(),
    );
    expect(capabilityV2Vector.expectedClaims).toMatchObject({
      action: capabilityV2Vector.operation.action,
      aud: capabilityV2Profile.audience,
      caller_kind: "interactive",
      cap_ver: 2,
      control_space_id: "control-space-contract-vector",
      iss: capabilityV2Profile.issuer,
      namespace_id: "workspace-contract-vector",
      resource: {
        id: "document-contract-vector",
        parent_id: "space-contract-vector",
        type: "document",
      },
      sub: "dify-account:account-contract-vector",
    });
    expect(capabilityV2Vector.expectedClaims.exp - capabilityV2Vector.expectedClaims.iat).toBe(
      capabilityV2Profile.maxTtlSeconds,
    );

    const verifier = createDifyCapabilityV2Verifier({
      audience: capabilityV2Profile.audience,
      issuer: capabilityV2Profile.issuer,
      jwks: createStaticDifyCapabilityV2JwksProvider({
        keys: [capabilityV2Vector.publicJwk],
      }),
      maxTtlSeconds: capabilityV2Profile.maxTtlSeconds,
      now: () => capabilityV2Vector.expectedClaims.iat,
    });
    const verified = await verifier.verify(capabilityV2Vector.token);
    expect(verified).toEqual({
      callerKind: capabilityV2Vector.expectedPrincipal.callerKind,
      claims: capabilityV2Vector.expectedClaims,
      subject: capabilityV2Vector.expectedPrincipal.subject,
    });

    await expect(
      createDifyCapabilityV2RequestGuard().authorize({
        claims: capabilityV2Vector.expectedClaims,
        request: new Request(
          `https://knowledge-fs.test${capabilityV2Vector.operation.requestPath}`,
          {
            method: capabilityV2Vector.operation.method,
          },
        ),
      }),
    ).resolves.toBeUndefined();
  });
});
