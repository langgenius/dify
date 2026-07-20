import { describe, expect, it } from "vitest";

import {
  DeletionLifecycleFenceActiveError,
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";

const scope = {
  documentAssetId: "document-1",
  knowledgeSpaceId: "space-1",
  sourceId: "source-1",
  tenantId: "tenant-1",
} as const;

describe("deletion lifecycle fence", () => {
  it("captures an unfenced scope and rejects a tombstone that appears before final write", async () => {
    const reader = createInMemoryDeletionLifecycleFenceReader();
    const guard = createDeletionLifecycleFenceGuard(reader);
    const token = await guard.captureDeletionFence(scope);

    await reader.activateFence({
      id: "fence-document",
      knowledgeSpaceId: scope.knowledgeSpaceId,
      targetId: scope.documentAssetId,
      targetType: "document",
      tenantId: scope.tenantId,
    });

    await expect(guard.assertDeletionFenceUnchanged(token)).rejects.toMatchObject({
      fence: { id: "fence-document", targetType: "document" },
      name: "DeletionLifecycleFenceActiveError",
    });
  });

  it.each([
    ["space", "space-1"],
    ["source", "source-1"],
    ["document", "document-1"],
  ] as const)("fails capture closed for an active %s tombstone", async (targetType, targetId) => {
    const reader = createInMemoryDeletionLifecycleFenceReader([
      {
        id: `fence-${targetType}`,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        targetId,
        targetType,
        tenantId: scope.tenantId,
      },
    ]);

    await expect(
      createDeletionLifecycleFenceGuard(reader).captureDeletionFence(scope),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
  });

  it("ignores tombstones outside the exact tenant and knowledge space", async () => {
    const reader = createInMemoryDeletionLifecycleFenceReader([
      {
        id: "other-tenant",
        knowledgeSpaceId: scope.knowledgeSpaceId,
        targetId: scope.knowledgeSpaceId,
        targetType: "space",
        tenantId: "tenant-2",
      },
      {
        id: "other-space",
        knowledgeSpaceId: "space-2",
        targetId: "space-2",
        targetType: "space",
        tenantId: scope.tenantId,
      },
    ]);
    const guard = createDeletionLifecycleFenceGuard(reader);

    const token = await guard.captureDeletionFence(scope);
    await expect(guard.assertDeletionFenceUnchanged(token)).resolves.toBeUndefined();
  });

  it("rejects malformed scopes and inconsistent space fences", async () => {
    const guard = createDeletionLifecycleFenceGuard(createInMemoryDeletionLifecycleFenceReader());
    await expect(guard.captureDeletionFence({ ...scope, tenantId: " tenant-1" })).rejects.toThrow(
      "Deletion lifecycle tenantId is invalid",
    );
    expect(() =>
      createInMemoryDeletionLifecycleFenceReader([
        {
          id: "bad-space",
          knowledgeSpaceId: "space-1",
          targetId: "space-2",
          targetType: "space",
          tenantId: "tenant-1",
        },
      ]),
    ).toThrow("Space deletion lifecycle fence must target its knowledgeSpaceId");
  });
});
