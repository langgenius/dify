import { describe, expect, it, vi } from "vitest";
import type { BulkOperation } from "./bulk-operation";

import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { registerOperationPolicyHandlers } from "./operation-policy-handlers";
import {
  getBulkOperationRoute,
  getKnowledgeSpaceRetentionPolicyRoute,
  getTenantRetentionPolicyRoute,
  updateKnowledgeSpaceRetentionPolicyRoute,
  updateTenantRetentionPolicyRoute,
} from "./operation-policy-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OPERATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };

describe("operation-policy handler branch coverage", () => {
  it("returns not found for an absent operation and denies a mismatched API-key space", async () => {
    expect((await operationFixture({ operation: null }).invoke(getBulkOperationRoute)).status).toBe(
      404,
    );
    expect(
      (
        await operationFixture({ callerKind: "api_key", keySpaceId: "another-space" }).invoke(
          getBulkOperationRoute,
        )
      ).status,
    ).toBe(403);
  });

  it("authorizes an exact job capability and rejects each mismatched binding", async () => {
    const exact = operationFixture({ capability: capabilityGrant() });
    expect((await exact.invoke(getBulkOperationRoute)).status).toBe(200);
    expect(exact.revalidatePermissionSnapshot).not.toHaveBeenCalled();

    for (const capability of [
      { ...capabilityGrant(), resource: { id: OPERATION_ID, parent_id: SPACE_ID, type: "query" } },
      { ...capabilityGrant(), resource: { id: "other", parent_id: SPACE_ID, type: "job" } },
      { ...capabilityGrant(), resource: { id: OPERATION_ID, parent_id: "other", type: "job" } },
      { ...capabilityGrant(), namespaceId: "other" },
      { ...capabilityGrant(), subject: "other" },
    ]) {
      expect(
        (
          await operationFixture({
            capability,
            operation: bulkOperation({ permissionSnapshot: undefined }),
          }).invoke(getBulkOperationRoute)
        ).status,
      ).toBe(404);
    }
  });

  it("requires exact requester provenance and maps durable revalidation denial", async () => {
    for (const operation of [
      bulkOperation({ requestedBySubjectId: "other" }),
      bulkOperation({ permissionSnapshot: undefined }),
    ]) {
      expect((await operationFixture({ operation }).invoke(getBulkOperationRoute)).status).toBe(
        404,
      );
    }

    const denied = operationFixture({
      revalidateError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "denied",
      ),
    });
    expect((await denied.invoke(getBulkOperationRoute)).status).toBe(404);
  });

  it("maps current authorization denial and propagates unexpected authorization failures", async () => {
    const denied = operationFixture({
      authorizeError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "denied",
      ),
    });
    expect((await denied.invoke(getBulkOperationRoute)).status).toBe(403);

    for (const options of [
      { authorizeError: new Error("authorization failed") },
      { revalidateError: new Error("revalidation failed") },
    ]) {
      const fixture = operationFixture(options);
      await expect(fixture.invoke(getBulkOperationRoute)).rejects.toBe(
        options.authorizeError ?? options.revalidateError,
      );
    }

    expect(
      (await operationFixture({ authorization: false }).invoke(getBulkOperationRoute)).status,
    ).toBe(200);
  });

  it("fails closed across document visibility boundaries", async () => {
    const cases = [
      bulkOperation({
        items: [{ documentId: DOCUMENT_ID, status: "not_found" }],
        requestedBySubjectId: "other",
      }),
      bulkOperation({
        items: [
          { documentId: DOCUMENT_ID, requiredPermissionScope: ["private"], status: "completed" },
        ],
      }),
      bulkOperation({ items: [{ documentId: DOCUMENT_ID, status: "completed" }] }),
    ];
    for (const operation of cases) {
      const fixture = operationFixture({
        ...(operation.items[0]?.requiredPermissionScope ? {} : { asset: null }),
        operation,
      });
      expect((await fixture.invoke(getBulkOperationRoute)).status).toBe(404);
    }

    const hiddenAsset = operationFixture({ asset: { metadata: { permissionScope: ["private"] } } });
    expect((await hiddenAsset.invoke(getBulkOperationRoute)).status).toBe(404);
  });

  it("allows requester-owned not-found rows and deleted assets carrying a durable scope binding", async () => {
    const notFound = operationFixture({
      operation: bulkOperation({ items: [{ documentId: DOCUMENT_ID, status: "not_found" }] }),
    });
    expect((await notFound.invoke(getBulkOperationRoute)).status).toBe(200);

    const deleted = operationFixture({
      asset: null,
      operation: bulkOperation({
        items: [{ documentId: DOCUMENT_ID, requiredPermissionScope: [], status: "completed" }],
      }),
    });
    expect((await deleted.invoke(getBulkOperationRoute)).status).toBe(200);

    const foreignNotFound = operationFixture({
      capability: capabilityGrant(),
      operation: bulkOperation({
        items: [{ documentId: DOCUMENT_ID, status: "not_found" }],
        requestedBySubjectId: "other",
      }),
    });
    expect((await foreignNotFound.invoke(getBulkOperationRoute)).status).toBe(404);
  });

  it("requires compilation job support only when an item references a job", async () => {
    const operation = bulkOperation({
      items: [{ compilationJobId: "job-1", documentId: DOCUMENT_ID, status: "queued" }],
    });
    expect(
      (
        await operationFixture({ documentCompilationJobs: false, operation }).invoke(
          getBulkOperationRoute,
        )
      ).status,
    ).toBe(503);
  });

  it("reads and updates tenant retention policy", async () => {
    const fixture = operationFixture();
    expect((await fixture.invoke(getTenantRetentionPolicyRoute)).status).toBe(200);
    expect((await fixture.invoke(updateTenantRetentionPolicyRoute)).status).toBe(200);
    expect(fixture.retention.update).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { tenantId: SUBJECT.tenantId } }),
    );
  });

  it("reads and updates existing space policy and hides a missing space", async () => {
    const fixture = operationFixture();
    expect((await fixture.invoke(getKnowledgeSpaceRetentionPolicyRoute)).status).toBe(200);
    expect((await fixture.invoke(updateKnowledgeSpaceRetentionPolicyRoute)).status).toBe(200);
    expect(fixture.retention.update).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { knowledgeSpaceId: SPACE_ID, tenantId: SUBJECT.tenantId },
      }),
    );

    const missing = operationFixture({ space: null });
    expect((await missing.invoke(getKnowledgeSpaceRetentionPolicyRoute)).status).toBe(404);
    expect((await missing.invoke(updateKnowledgeSpaceRetentionPolicyRoute)).status).toBe(404);
  });
});

interface OperationFixtureOptions {
  readonly asset?: unknown;
  readonly authorization?: boolean;
  readonly authorizeError?: Error;
  readonly callerKind?: string;
  readonly capability?: unknown;
  readonly documentCompilationJobs?: boolean;
  readonly keySpaceId?: string;
  readonly operation?: BulkOperation | null;
  readonly revalidateError?: Error;
  readonly space?: unknown;
}

function operationFixture(options: OperationFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const revalidatePermissionSnapshot = vi.fn(async () => {
    if (options.revalidateError) throw options.revalidateError;
    return {
      accessChannel: "interactive",
      apiKeyId: undefined,
      permissionScopes: [],
      revision: 1,
    };
  });
  const update = vi.fn(async () => ({ retentionDays: 30 }));
  const retention = { get: vi.fn(async () => ({ retentionDays: 30 })), update };
  registerOperationPolicyHandlers({
    access: { revalidatePermissionSnapshot } as never,
    app: app as never,
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { metadata: {} } : options.asset)),
    } as never,
    ...(options.authorization === false
      ? {}
      : {
          authorization: {
            authorize: vi.fn(async () => {
              if (options.authorizeError) throw options.authorizeError;
              return {};
            }),
          } as never,
        }),
    bulkOperationRepository: {
      get: vi.fn(async () =>
        options.operation === undefined ? bulkOperation() : options.operation,
      ),
    } as never,
    documentCompilationJobs:
      options.documentCompilationJobs === false ? undefined : ({ get: vi.fn() } as never),
    retentionPolicyRepository: retention as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });
  return {
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(operationContext(options, route) as never);
    },
    retention,
    revalidatePermissionSnapshot,
  };
}

function operationContext(options: OperationFixtureOptions, route: unknown) {
  const values = new Map<string, unknown>([
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["callerKind", options.callerKind],
    ["capabilityV2Grant", options.capability],
    ["subject", SUBJECT],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      valid: (part: string) => {
        if (part === "param")
          return { id: route === getBulkOperationRoute ? OPERATION_ID : SPACE_ID };
        return { retentionDays: 30 };
      },
    },
  };
}

function bulkOperation(overrides: Partial<BulkOperation> = {}): BulkOperation {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    id: OPERATION_ID,
    items: [{ documentId: DOCUMENT_ID, status: "completed" }],
    knowledgeSpaceId: SPACE_ID,
    permissionSnapshot: { accessChannel: "interactive", id: "permission-1", revision: 1 },
    requestedBySubjectId: SUBJECT.subjectId,
    tenantId: SUBJECT.tenantId,
    type: "document_delete",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function capabilityGrant() {
  return {
    contentScopeIds: [],
    namespaceId: SUBJECT.tenantId,
    resource: { id: OPERATION_ID, parent_id: SPACE_ID, type: "job" },
    subject: SUBJECT.subjectId,
  };
}
