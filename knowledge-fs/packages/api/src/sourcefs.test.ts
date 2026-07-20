import { createNodePlatformAdapter } from "@knowledge/adapters";
import { ResourceMountSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type SourceFsGrepResult,
  type SourceFsListResult,
  createInMemoryResourceMountRepository,
  createSourceFsCommandRegistry,
} from "./index";

const subject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("SourceFS mount inspection tools", () => {
  it("lists, reads, and greps upload/object-storage mounts through bounded commands", async () => {
    const adapter = createNodePlatformAdapter();
    const mounts = createInMemoryResourceMountRepository({ maxMounts: 2 });
    await mounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls", "cat", "grep"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8001",
        knowledgeSpaceId,
        metadata: { label: "Uploads" },
        mode: "read",
        mountPath: "/sources/uploads",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "upload",
        resourceType: "source",
        sourcePointer: "upload://tenant-1/uploads/",
        tenantId: "tenant-1",
      }),
    );
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("Renewal policy root"),
      contentType: "text/markdown",
      key: "tenant-1/uploads/readme.md",
      metadata: { owner: "legal" },
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("Nested renewal details"),
      contentType: "text/plain",
      key: "tenant-1/uploads/contracts/renewal.txt",
      metadata: { owner: "sales" },
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("Appendix"),
      key: "tenant-1/uploads/contracts/appendix.txt",
    });
    const registry = createSourceFsCommandRegistry({
      maxGrepMatches: 5,
      maxGrepObjects: 5,
      maxListLimit: 10,
      maxReadBytes: 1024,
      mounts,
      objectStorage: adapter.objectStorage,
    });

    const list = await registry.execute({
      context: { resourceType: "source", subject, traceId: "trace-1" },
      input: { knowledgeSpaceId, limit: 10, path: "/sources/uploads" },
      name: "ls",
    });
    expect(list.output).toEqual({
      items: [
        {
          kind: "directory",
          metadata: {},
          name: "contracts",
          path: "/sources/uploads/contracts",
        },
        {
          contentType: "text/markdown",
          kind: "object",
          metadata: { owner: "legal" },
          name: "readme.md",
          path: "/sources/uploads/readme.md",
          sizeBytes: 19,
        },
      ],
      path: "/sources/uploads",
      truncated: false,
    });

    const cat = await registry.execute({
      context: { resourceType: "source", subject, traceId: "trace-1" },
      input: { knowledgeSpaceId, path: "/sources/uploads/readme.md" },
      name: "cat",
    });
    expect(cat.output).toEqual({
      contentType: "text/markdown",
      path: "/sources/uploads/readme.md",
      sizeBytes: 19,
      text: "Renewal policy root",
      truncated: false,
    });

    const grep = await registry.execute({
      context: { resourceType: "source", subject, traceId: "trace-1" },
      input: { knowledgeSpaceId, limit: 5, path: "/sources/uploads", q: "renewal" },
      name: "grep",
    });
    expect(grep.output).toMatchObject({
      matches: [
        {
          contentType: "text/plain",
          endOffset: 14,
          path: "/sources/uploads/contracts/renewal.txt",
          snippet: "Nested renewal details",
          startOffset: 7,
        },
        {
          contentType: "text/markdown",
          endOffset: 7,
          path: "/sources/uploads/readme.md",
          snippet: "Renewal policy root",
          startOffset: 0,
        },
      ],
      path: "/sources/uploads",
      truncated: false,
    });

    const noMatch = await registry.execute({
      context: { resourceType: "source", subject, traceId: "trace-1" },
      input: { knowledgeSpaceId, limit: 5, path: "/sources/uploads", q: "missing" },
      name: "grep",
    });
    expect(noMatch.output).toEqual({
      matches: [],
      path: "/sources/uploads",
      truncated: false,
    });
    const firstGrepPage = await registry.execute<SourceFsGrepResult>({
      context: { resourceType: "source", subject, traceId: "trace-1" },
      input: { knowledgeSpaceId, limit: 1, path: "/sources/uploads", q: "renewal" },
      name: "grep",
    });
    expect(firstGrepPage.output).toMatchObject({
      matches: [
        {
          path: "/sources/uploads/contracts/renewal.txt",
        },
      ],
      truncated: true,
    });
    expect(firstGrepPage.output.nextCursor).toBe("tenant-1/uploads/contracts/renewal.txt");
  });

  it("enforces tenant isolation, capabilities, explicit bounds, and read-size limits", async () => {
    const adapter = createNodePlatformAdapter();
    const mounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await mounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8002",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/restricted",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "object-storage",
        resourceType: "source",
        sourcePointer: "object://tenant-1/restricted/",
        tenantId: "tenant-1",
      }),
    );
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("too large"),
      contentType: "text/plain",
      key: "tenant-1/restricted/large.txt",
    });
    const registry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 4,
      mounts,
      objectStorage: adapter.objectStorage,
    });

    await expect(
      registry.execute({
        context: {
          resourceType: "source",
          subject: { ...subject, tenantId: "tenant-2" },
          traceId: "trace-2",
        },
        input: { knowledgeSpaceId, limit: 1, path: "/sources/restricted" },
        name: "ls",
      }),
    ).rejects.toThrow("SourceFS mount not found");
    await expect(
      registry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, limit: 2, path: "/sources/restricted" },
        name: "ls",
      }),
    ).rejects.toThrow("SourceFS list limit exceeds maxListLimit=1");
    await expect(
      registry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted/large.txt" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS mount /sources/restricted does not support cat");

    const readableMounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await readableMounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["cat"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8003",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/restricted",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "object-storage",
        resourceType: "source",
        sourcePointer: "object://tenant-1/restricted/",
        tenantId: "tenant-1",
      }),
    );
    const readableRegistry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 4,
      mounts: readableMounts,
      objectStorage: adapter.objectStorage,
    });

    await expect(
      readableRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted/large.txt" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS object exceeds maxReadBytes=4");
    await expect(
      readableRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted/missing.txt" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS object not found");
    await expect(
      readableRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS object not found");
    await expect(
      readableRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, limit: 2, path: "/sources/restricted", q: "large" },
        name: "grep",
      }),
    ).rejects.toThrow("SourceFS grep limit exceeds maxGrepMatches=1");

    const staleHeadRegistry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 4,
      mounts: readableMounts,
      objectStorage: {
        ...adapter.objectStorage,
        getObject: async () => new TextEncoder().encode("too large"),
        getObjectStream: async () => null,
        headObject: async (key) => ({
          key,
          metadata: {},
          sizeBytes: 3,
        }),
      },
    });
    await expect(
      staleHeadRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted/large.txt" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS object exceeds maxReadBytes=4");

    const missingBodyRegistry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 64,
      mounts: readableMounts,
      objectStorage: {
        ...adapter.objectStorage,
        getObject: async () => null,
        getObjectStream: async () => null,
        headObject: async (key) => ({
          key,
          metadata: {},
          sizeBytes: 3,
        }),
      },
    });
    await expect(
      missingBodyRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-2" },
        input: { knowledgeSpaceId, path: "/sources/restricted/large.txt" },
        name: "cat",
      }),
    ).rejects.toThrow("SourceFS object not found");
  });

  it("rejects invalid mount configuration and traversal paths", async () => {
    expect(() => createInMemoryResourceMountRepository({ maxMounts: 0 })).toThrow(
      "Resource mount repository maxMounts must be at least 1",
    );
    expect(() =>
      createSourceFsCommandRegistry({
        maxGrepMatches: 1,
        maxGrepObjects: 1,
        maxListLimit: 0,
        maxReadBytes: 1,
        mounts: createInMemoryResourceMountRepository({ maxMounts: 1 }),
        objectStorage: createNodePlatformAdapter().objectStorage,
      }),
    ).toThrow("SourceFS maxListLimit must be an integer >= 1");

    const adapter = createNodePlatformAdapter();
    const mounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await mounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8004",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/bad-pointer",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "upload",
        resourceType: "source",
        sourcePointer: "s3://tenant-1/bad-pointer",
        tenantId: "tenant-1",
      }),
    );
    const registry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 1,
      mounts,
      objectStorage: adapter.objectStorage,
    });
    await expect(
      registry.execute({
        context: { resourceType: "source", subject, traceId: "trace-3" },
        input: { knowledgeSpaceId, limit: 1, path: "/sources/bad-pointer" },
        name: "ls",
      }),
    ).rejects.toThrow("SourceFS mount sourcePointer must use upload:// or object://");

    const connectorMounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await connectorMounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8005",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/connector",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "connector",
        resourceType: "source",
        sourcePointer: "upload://tenant-1/connector",
        tenantId: "tenant-1",
      }),
    );
    const connectorRegistry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 1,
      mounts: connectorMounts,
      objectStorage: adapter.objectStorage,
    });
    await expect(
      connectorRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-3" },
        input: { knowledgeSpaceId, limit: 1, path: "/sources/connector" },
        name: "ls",
      }),
    ).rejects.toThrow("SourceFS provider connector is not supported");
    await expect(
      connectorMounts.findByPath({
        knowledgeSpaceId,
        path: "/sources/../secret",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("SourceFS path must not contain traversal segments");
    await expect(
      connectorMounts.findByPath({
        knowledgeSpaceId,
        path: "/tmp/secret",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("SourceFS path must be under /sources");

    await expect(
      connectorMounts.create(
        ResourceMountSchema.parse({
          cachePolicy: { strategy: "none" },
          capabilities: ["ls"],
          createdAt: "2026-05-11T00:00:00.000Z",
          freshnessPolicy: { strategy: "manual" },
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8006",
          knowledgeSpaceId,
          metadata: {},
          mode: "read",
          mountPath: "/sources/overflow",
          permissionScope: ["tenant:tenant-1"],
          permissionSnapshotVersion: 1,
          provider: "upload",
          resourceType: "source",
          sourcePointer: "upload://tenant-1/overflow",
          tenantId: "tenant-1",
        }),
      ),
    ).rejects.toThrow("Resource mount repository maxMounts=1 exceeded");

    const emptyKeyMounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await emptyKeyMounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8007",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/empty-key",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "upload",
        resourceType: "source",
        sourcePointer: "upload://tenant-1/empty-key/",
        tenantId: "tenant-1",
      }),
    );
    await adapter.objectStorage.putObject({
      body: new Uint8Array(),
      key: "tenant-1/empty-key/",
    });
    const emptyKeyRegistry = createSourceFsCommandRegistry({
      maxGrepMatches: 1,
      maxGrepObjects: 1,
      maxListLimit: 1,
      maxReadBytes: 1,
      mounts: emptyKeyMounts,
      objectStorage: adapter.objectStorage,
    });
    await expect(
      emptyKeyRegistry.execute({
        context: { resourceType: "source", subject, traceId: "trace-3" },
        input: { knowledgeSpaceId, limit: 1, path: "/sources/empty-key" },
        name: "ls",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [],
        truncated: false,
      },
    });
  });

  it("pages subdirectories with cursors and handles objects without content types", async () => {
    const adapter = createNodePlatformAdapter();
    const mounts = createInMemoryResourceMountRepository({ maxMounts: 1 });
    await mounts.create(
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls", "cat", "grep"],
        createdAt: "2026-05-11T00:00:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8008",
        knowledgeSpaceId,
        metadata: {},
        mode: "read",
        mountPath: "/sources/uploads",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "upload",
        resourceType: "source",
        sourcePointer: "upload://tenant-1/uploads/",
        tenantId: "tenant-1",
      }),
    );
    // No contentType on either object: entries, cat results, and grep matches omit it.
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("alpha renewal"),
      key: "tenant-1/uploads/contracts/alpha.txt",
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("beta renewal"),
      key: "tenant-1/uploads/contracts/beta.txt",
    });
    const registry = createSourceFsCommandRegistry({
      maxGrepMatches: 5,
      maxGrepObjects: 5,
      maxListLimit: 10,
      maxReadBytes: 1024,
      mounts,
      objectStorage: adapter.objectStorage,
    });
    const context = { resourceType: "source" as const, subject, traceId: "trace-4" };
    const directory = "/sources/uploads/contracts";

    // Listing a subdirectory exercises the non-slash-terminated object prefix.
    const firstPage = await registry.execute<SourceFsListResult>({
      context,
      input: { knowledgeSpaceId, limit: 1, path: directory },
      name: "ls",
    });
    expect(firstPage.output.items).toEqual([
      {
        kind: "object",
        metadata: {},
        name: "alpha.txt",
        // Virtual object paths are composed from the mount path plus the key's remainder
        // beyond the listed prefix.
        path: "/sources/uploads/alpha.txt",
        sizeBytes: 13,
      },
    ]);
    expect(firstPage.output.truncated).toBe(true);
    expect(firstPage.output.nextCursor).toBeDefined();

    const secondPage = await registry.execute<SourceFsListResult>({
      context,
      input: {
        cursor: firstPage.output.nextCursor,
        knowledgeSpaceId,
        limit: 10,
        path: directory,
      },
      name: "ls",
    });
    expect(secondPage.output.items.map((entry) => entry.name)).toEqual(["beta.txt"]);
    expect(secondPage.output.truncated).toBe(false);

    const cat = await registry.execute({
      context,
      input: { knowledgeSpaceId, path: `${directory}/alpha.txt` },
      name: "cat",
    });
    expect(cat.output).toEqual({
      path: `${directory}/alpha.txt`,
      sizeBytes: 13,
      text: "alpha renewal",
      truncated: false,
    });

    const firstGrep = await registry.execute<SourceFsGrepResult>({
      context,
      input: { knowledgeSpaceId, limit: 1, path: directory, q: "renewal" },
      name: "grep",
    });
    expect(firstGrep.output.matches).toEqual([
      {
        endOffset: 13,
        metadata: {},
        path: "/sources/uploads/alpha.txt",
        sizeBytes: 13,
        snippet: "alpha renewal",
        startOffset: 6,
      },
    ]);
    expect(firstGrep.output.truncated).toBe(true);
    expect(firstGrep.output.nextCursor).toBe("tenant-1/uploads/contracts/alpha.txt");

    const secondGrep = await registry.execute<SourceFsGrepResult>({
      context,
      input: {
        cursor: firstGrep.output.nextCursor,
        knowledgeSpaceId,
        limit: 5,
        path: directory,
        q: "renewal",
      },
      name: "grep",
    });
    expect(secondGrep.output.matches.map((match) => match.path)).toEqual([
      "/sources/uploads/beta.txt",
    ]);
    expect(secondGrep.output.truncated).toBe(false);
  });
});
