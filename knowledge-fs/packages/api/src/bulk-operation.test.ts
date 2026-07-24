import { describe, expect, it } from "vitest";

import { type BulkOperationItem, createInMemoryBulkOperationRepository } from "./bulk-operation";

describe("bulk operation repository", () => {
  it("creates tenant-scoped clone-isolated bulk operations", async () => {
    const repository = createInMemoryBulkOperationRepository({
      maxItems: 2,
      maxOperations: 2,
      now: () => "2026-05-13T00:00:00.000Z",
    });
    const items: BulkOperationItem[] = [
      { documentId: "document-1", requiredPermissionScope: ["scope-1"], status: "queued" },
    ];

    const operation = await repository.create({
      id: "bulk-1",
      items,
      knowledgeSpaceId: "space-1",
      tenantId: "tenant-1",
      type: "document_delete",
    });

    expect(operation).toEqual({
      createdAt: "2026-05-13T00:00:00.000Z",
      id: "bulk-1",
      items: [{ documentId: "document-1", requiredPermissionScope: ["scope-1"], status: "queued" }],
      knowledgeSpaceId: "space-1",
      tenantId: "tenant-1",
      type: "document_delete",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });

    items[0] = { documentId: "document-mutated", status: "failed" };
    const mutableItem = operation.items[0] as { status: string };
    mutableItem.status = "failed";

    await expect(repository.get({ id: "bulk-1", tenantId: "tenant-1" })).resolves.toMatchObject({
      items: [{ documentId: "document-1", requiredPermissionScope: ["scope-1"], status: "queued" }],
    });
    await expect(repository.get({ id: "bulk-1", tenantId: "tenant-2" })).resolves.toBeNull();
  });

  it("bounds operations and item counts", async () => {
    const repository = createInMemoryBulkOperationRepository({
      maxItems: 1,
      maxOperations: 1,
      now: () => "2026-05-13T00:00:00.000Z",
    });
    const input = {
      id: "bulk-1",
      items: [{ documentId: "document-1", status: "queued" as const }],
      knowledgeSpaceId: "space-1",
      tenantId: "tenant-1",
      type: "document_upload" as const,
    };

    await repository.create(input);
    await repository.create({ ...input, items: [{ documentId: "document-2", status: "queued" }] });
    await expect(repository.create({ ...input, id: "bulk-2" })).rejects.toThrow(
      "Bulk operation repository maxOperations=1 exceeded",
    );
    await expect(
      repository.create({
        ...input,
        items: [
          { documentId: "document-1", status: "queued" },
          { documentId: "document-2", status: "queued" },
        ],
      }),
    ).rejects.toThrow("Bulk operation repository maxItems=1 exceeded");
    expect(() => createInMemoryBulkOperationRepository({ maxItems: 0, maxOperations: 1 })).toThrow(
      "Bulk operation repository maxItems must be at least 1",
    );
    expect(() => createInMemoryBulkOperationRepository({ maxItems: 1, maxOperations: 0 })).toThrow(
      "Bulk operation repository maxOperations must be at least 1",
    );
  });

  it("lists newest visible operations and binds not-found results to their requester", async () => {
    let timestamp = "2026-05-13T00:00:00.000Z";
    const repository = createInMemoryBulkOperationRepository({
      maxItems: 2,
      maxOperations: 10,
      now: () => timestamp,
    });
    await repository.create({
      capabilityGrantId: "grant-1",
      id: "bulk-old",
      items: [
        {
          compilationJobId: "compilation-old",
          documentId: "document-old",
          requiredPermissionScope: ["scope-1"],
          status: "queued",
        },
      ],
      knowledgeSpaceId: "space-1",
      tenantId: "tenant-1",
      type: "document_reindex",
    });
    timestamp = "2026-05-13T00:01:00.000Z";
    await repository.create({
      capabilityGrantId: "grant-2",
      id: "bulk-new",
      items: [{ documentId: "missing", status: "not_found" }],
      knowledgeSpaceId: "space-1",
      requestedBySubjectId: "requester-1",
      tenantId: "tenant-1",
      type: "document_reindex",
    });

    const first = await repository.list({
      candidateGrants: ["scope-1"],
      knowledgeSpaceId: "space-1",
      limit: 1,
      requestedBySubjectId: "requester-1",
      tenantId: "tenant-1",
    });
    expect(first).toMatchObject({
      items: [{ id: "bulk-new" }],
      nextCursor: { createdAt: timestamp, id: "bulk-new" },
    });
    await expect(
      repository.findGroupedCompilationJobIds({
        candidateGrants: ["scope-1"],
        compilationJobIds: ["compilation-old"],
        knowledgeSpaceId: "space-1",
        requestedBySubjectId: "requester-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual(["compilation-old"]);
    await expect(
      repository.list({
        candidateGrants: ["scope-1"],
        cursor: first.nextCursor,
        knowledgeSpaceId: "space-1",
        limit: 1,
        requestedBySubjectId: "requester-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ items: [{ id: "bulk-old" }] });
    await expect(
      repository.list({
        candidateGrants: ["scope-1"],
        knowledgeSpaceId: "space-1",
        limit: 10,
        requestedBySubjectId: "other-requester",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ items: [{ id: "bulk-old" }] });
    await expect(
      repository.list({
        candidateGrants: [],
        knowledgeSpaceId: "space-1",
        limit: 10,
        requestedBySubjectId: "other-requester",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ items: [] });
  });
});
