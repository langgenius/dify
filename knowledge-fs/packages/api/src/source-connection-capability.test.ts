import { describe, expect, it, vi } from "vitest";

import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import {
  type SourceConnectionPermissionFence,
  createInMemorySourceConnectionRepository,
  createSourceConnectionService,
} from "./source-connection";
import { createStaticSourceProviderCatalog } from "./source-provider-catalog";

const tenantId = "tenant-capability";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const connectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12";
const grantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13";
const now = "2026-07-28T10:00:00.000Z";
const subject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "dify-account:editor-a",
  tenantId,
};

describe("SourceConnectionService Capability v2", () => {
  it("creates, gets, and lists a Dify-managed connection without consulting local ACL state", async () => {
    const localCreatePermission = vi.fn(async () => {
      throw new Error("integrated spaces do not have local permission snapshots");
    });
    const localRevalidatePermission = vi.fn(async () => {
      throw new Error("integrated spaces do not have local permission snapshots");
    });
    const localAuthorize = vi.fn(async () => {
      throw new Error("integrated spaces do not have local ACL aggregates");
    });
    const baseRepository = createInMemorySourceConnectionRepository();
    const observedFences: SourceConnectionPermissionFence[] = [];
    const repository = {
      ...baseRepository,
      activate: async (input: Parameters<typeof baseRepository.activate>[0]) => {
        observedFences.push(input.permissionFence);
        return baseRepository.activate(input);
      },
      begin: async (input: Parameters<typeof baseRepository.begin>[0]) => {
        observedFences.push(input.permissionFence);
        return baseRepository.begin(input);
      },
    };
    const service = createSourceConnectionService({
      access: {
        createPermissionSnapshot: localCreatePermission,
        revalidatePermissionSnapshot: localRevalidatePermission,
      },
      authorization: { authorize: localAuthorize },
      catalog: createStaticSourceProviderCatalog([
        {
          authKinds: ["endpoint"],
          available: true,
          capabilities: ["online-document"],
          configuration: [],
          displayName: "Dify online document",
          id: "plugin-daemon-online-document",
        },
      ]),
      credentialMode: "dify-managed",
      generateConnectionId: () => connectionId,
      now: () => now,
      oauth: { get: () => undefined },
      repository,
    });

    const created = await service.create({
      authKind: "endpoint",
      callerKind: "interactive",
      capability: { contentScopeIds: [], grantId },
      credentials: {},
      knowledgeSpaceId,
      name: "Notion",
      providerId: "plugin-daemon-online-document",
      subject,
      tenantId,
    });

    expect(created).toMatchObject({
      id: connectionId,
      knowledgeSpaceId,
      status: "active",
      version: 2,
    });
    expect(created).not.toHaveProperty("capabilityGrantId");
    expect(observedFences).toEqual([
      {
        capabilityAction: "source_connections.create",
        capabilityGrantId: grantId,
        knowledgeSpaceId,
        tenantId,
      },
      {
        capabilityAction: "source_connections.create",
        capabilityGrantId: grantId,
        knowledgeSpaceId,
        tenantId,
      },
    ]);
    await expect(service.get({ connectionId, knowledgeSpaceId, tenantId })).resolves.toEqual(
      created,
    );
    await expect(service.list({ knowledgeSpaceId, limit: 50, tenantId })).resolves.toMatchObject({
      items: [created],
    });
    expect(localCreatePermission).not.toHaveBeenCalled();
    expect(localRevalidatePermission).not.toHaveBeenCalled();
    expect(localAuthorize).not.toHaveBeenCalled();
  });

  it("maps a grant revoked between request admission and connection persistence to access denied", async () => {
    const localAuthorize = vi.fn(async () => {
      throw new Error("local ACL must remain unused");
    });
    const baseRepository = createInMemorySourceConnectionRepository();
    const service = createSourceConnectionService({
      access: {
        createPermissionSnapshot: vi.fn(async () => {
          throw new Error("local ACL must remain unused");
        }),
        revalidatePermissionSnapshot: vi.fn(async () => {
          throw new Error("local ACL must remain unused");
        }),
      },
      authorization: { authorize: localAuthorize },
      catalog: createStaticSourceProviderCatalog([
        {
          authKinds: ["endpoint"],
          available: true,
          capabilities: ["online-document"],
          configuration: [],
          displayName: "Dify online document",
          id: "plugin-daemon-online-document",
        },
      ]),
      credentialMode: "dify-managed",
      generateConnectionId: () => connectionId,
      now: () => now,
      oauth: { get: () => undefined },
      repository: {
        ...baseRepository,
        begin: async () => {
          throw new CapabilityPublicationFencedError();
        },
      },
    });

    await expect(
      service.create({
        authKind: "endpoint",
        callerKind: "interactive",
        capability: { contentScopeIds: [], grantId },
        credentials: {},
        knowledgeSpaceId,
        name: "Notion",
        providerId: "plugin-daemon-online-document",
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
    expect(localAuthorize).not.toHaveBeenCalled();
  });

  it("fences activation when the admitted grant is revoked after the provisioning row is written", async () => {
    const baseRepository = createInMemorySourceConnectionRepository();
    const service = createSourceConnectionService({
      access: {
        createPermissionSnapshot: vi.fn(async () => {
          throw new Error("local ACL must remain unused");
        }),
        revalidatePermissionSnapshot: vi.fn(async () => {
          throw new Error("local ACL must remain unused");
        }),
      },
      authorization: {
        authorize: vi.fn(async () => {
          throw new Error("local ACL must remain unused");
        }),
      },
      catalog: createStaticSourceProviderCatalog([
        {
          authKinds: ["endpoint"],
          available: true,
          capabilities: ["online-document"],
          configuration: [],
          displayName: "Dify online document",
          id: "plugin-daemon-online-document",
        },
      ]),
      credentialMode: "dify-managed",
      generateConnectionId: () => connectionId,
      now: () => now,
      oauth: { get: () => undefined },
      repository: {
        ...baseRepository,
        activate: async () => {
          throw new CapabilityPublicationFencedError();
        },
      },
    });

    await expect(
      service.create({
        authKind: "endpoint",
        callerKind: "interactive",
        capability: { contentScopeIds: [], grantId },
        credentials: {},
        knowledgeSpaceId,
        name: "Notion",
        providerId: "plugin-daemon-online-document",
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
    await expect(
      baseRepository.get({ connectionId, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({
      capabilityGrantId: grantId,
      lastErrorCode: "SOURCE_CONNECTION_PROVIDER_FAILED",
      status: "error",
    });
  });
});
