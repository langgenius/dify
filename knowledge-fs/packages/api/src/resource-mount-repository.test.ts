import { type ResourceMount, ResourceMountSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  ResourceMountCapacityExceededError,
  createInMemoryResourceMountRepository,
  resourceMountPathCachePolicy,
} from "./resource-mount-repository";

function resourceMount(overrides: Partial<ResourceMount> = {}) {
  return ResourceMountSchema.parse({
    cachePolicy: { strategy: "none" },
    capabilities: ["ls", "cat"],
    createdAt: "2026-05-12T16:18:00.000Z",
    freshnessPolicy: { strategy: "manual" },
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d11",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { label: "docs" },
    mode: "read",
    mountPath: "/sources/uploads",
    permissionScope: ["tenant:tenant-1"],
    permissionSnapshotVersion: 1,
    provider: "object-storage",
    resourceType: "source",
    sourcePointer: "s3://knowledge-fs/tenant-1/uploads",
    tenantId: "tenant-1",
    ...overrides,
  });
}

describe("createInMemoryResourceMountRepository", () => {
  it("stores and returns clone-isolated resource mounts", async () => {
    const repository = createInMemoryResourceMountRepository({ maxMounts: 2 });
    const created = await repository.create(resourceMount());

    created.metadata.label = "mutated";

    const found = await repository.findByPath({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      path: "/sources/uploads/readme.md",
      tenantId: "tenant-1",
    });

    expect(found?.metadata.label).toBe("docs");

    if (found) {
      found.metadata.label = "mutated-again";
    }

    await expect(
      repository.findByPath({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        path: "/sources/uploads/readme.md",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      metadata: { label: "docs" },
      mountPath: "/sources/uploads",
    });
  });

  it("finds the longest source mount scoped by tenant and knowledge space", async () => {
    const repository = createInMemoryResourceMountRepository({ maxMounts: 4 });

    await repository.create(
      resourceMount({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d12",
        mountPath: "/sources/uploads",
      }),
    );
    await repository.create(
      resourceMount({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d13",
        mountPath: "/sources/uploads/projects",
        sourcePointer: "s3://knowledge-fs/tenant-1/uploads/projects",
      }),
    );
    await repository.create(
      resourceMount({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d14",
        mountPath: "/sources/uploads/projects",
        sourcePointer: "s3://knowledge-fs/tenant-2/uploads/projects",
        tenantId: "tenant-2",
      }),
    );

    await expect(
      repository.findByPath({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        path: "/sources/uploads/projects/plan.md",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d13" });

    await expect(
      repository.findByPath({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        path: "/sources/uploads/projects/plan.md",
        tenantId: "tenant-3",
      }),
    ).resolves.toBeNull();
  });

  it("normalizes mount cache policy for path metadata cache use", async () => {
    const uncached = resourceMountPathCachePolicy(
      resourceMount({ cachePolicy: { strategy: "none" } }),
    );
    expect(uncached).toEqual({ enabled: false, strategy: "none" });

    const cached = resourceMountPathCachePolicy(
      resourceMount({
        cachePolicy: {
          maxBytes: 1_048_576,
          strategy: "memory",
          ttlSeconds: 30,
        },
      }),
    );
    expect(cached).toEqual({
      enabled: true,
      maxBytes: 1_048_576,
      strategy: "memory",
      ttlMs: 30_000,
    });
  });

  it("rejects invalid bounds and capacity overflow", async () => {
    expect(() => createInMemoryResourceMountRepository({ maxMounts: 0 })).toThrow(
      "Resource mount repository maxMounts must be at least 1",
    );

    const repository = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await repository.create(
      resourceMount({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d15",
        mountPath: "/sources/a",
      }),
    );

    await expect(
      repository.create(
        resourceMount({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d16",
          mountPath: "/sources/b",
        }),
      ),
    ).rejects.toBeInstanceOf(ResourceMountCapacityExceededError);
  });
});
