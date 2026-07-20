import { describe, expect, it } from "vitest";

import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import {
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createKnowledgeFsCommandRegistry } from "./knowledge-fs-command-registry";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

import type { ComputeRuntime } from "@knowledge/compute";
import {
  ArtifactSegmentSchema,
  KnowledgePathSchema,
  ParseArtifactSchema,
  type PlatformAdapter,
} from "@knowledge/core";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("createKnowledgeFsCommandRegistry", () => {
  it("registers the bounded KnowledgeFS workspace commands", () => {
    const registry = createKnowledgeFsCommandRegistry({
      assets: {},
      compute: {},
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {},
      paths: {},
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    expect(registry.list().map((command) => command.name)).toEqual([
      "ls",
      "tree",
      "grep",
      "find",
      "diff",
      "open_node",
      "cat",
      "stat",
      "write",
      "append",
    ]);
    expect(registry.get("cat")).toMatchObject({
      cachePolicy: { strategy: "none" },
      degradation: { strategy: "fail-closed" },
      supportedResourceTypes: ["workspace"],
    });
    for (const command of registry.list()) {
      expect(command.cachePolicy).toEqual({ strategy: "none" });
    }
  });

  it("rejects execution without read scope before touching storage dependencies", async () => {
    const registry = createKnowledgeFsCommandRegistry({
      assets: {},
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths: {},
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: [],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          limit: 10,
          path: "/knowledge",
        },
        name: "ls",
      }),
    ).rejects.toThrow("permission denied");
  });

  it("reads artifact paths from bounded segment pages", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d20",
        knowledgeSpaceId: SPACE_ID,
        metadata: { contentType: "text/markdown" },
        resourceType: "artifact",
        targetId: ARTIFACT_ID,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/roadmap.md",
      }),
    );
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    await artifactSegments.createMany({
      segments: [segment(0, "alpha\n"), segment(1, "bravo\n")],
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 2 });
    await createOpenTestAsset(assets);
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments,
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    const firstPage = await registry.execute({
      context: {
        resourceType: "workspace",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "subject-1",
          tenantId: "tenant-1",
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/by-topic/roadmap.md",
      },
      name: "cat",
    });

    expect(firstPage.output).toEqual({
      contentType: "text/markdown",
      nextCursor: "0",
      path: "/knowledge/by-topic/roadmap.md",
      text: "alpha\n",
      truncated: true,
    });
    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          cursor: "0",
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: "/knowledge/by-topic/roadmap.md",
        },
        name: "cat",
      }),
    ).resolves.toMatchObject({
      output: {
        text: "bravo\n",
        truncated: false,
      },
    });

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          consistencyClass: "snapshot-consistent",
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: "/knowledge/by-topic/roadmap.md",
        },
        name: "cat",
      }),
    ).resolves.toMatchObject({
      output: {
        text: "alpha\n",
      },
    });
  });

  it("rejects eventual-preview consistency for citation-ready content commands", async () => {
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets: {},
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths: createInMemoryKnowledgePathRepository({
        maxListLimit: 10,
        maxPaths: 10,
      }),
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          consistencyClass: "eventual-preview",
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/by-topic/roadmap.md",
        },
        name: "cat",
      }),
    ).rejects.toThrow("KnowledgeFS command cat does not support eventual-preview consistency");
  });

  it("flags eventual-preview metadata reads without enabling command cache", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d24",
        knowledgeSpaceId: SPACE_ID,
        metadata: { contentType: "text/markdown" },
        resourceType: "artifact",
        targetId: ARTIFACT_ID,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/preview.md",
      }),
    );
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets: {},
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          consistencyClass: "eventual-preview",
          knowledgeSpaceId: SPACE_ID,
          limit: 10,
          path: "/knowledge/by-topic",
        },
        name: "ls",
      }),
    ).resolves.toMatchObject({
      output: {
        consistencyClass: "eventual-preview",
        preview: true,
      },
    });
    expect(registry.get("ls")?.cachePolicy).toEqual({ strategy: "none" });
  });

  it("greps artifact paths from bounded segment pages", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
        knowledgeSpaceId: SPACE_ID,
        resourceType: "artifact",
        targetId: ARTIFACT_ID,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/segments.md",
      }),
    );
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    await artifactSegments.createMany({
      segments: [segment(0, "alpha roadmap\n"), segment(1, "bravo roadmap\n")],
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 2 });
    await createOpenTestAsset(assets);
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments,
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: "/knowledge/by-topic/segments.md",
          q: "roadmap",
        },
        name: "grep",
      }),
    ).resolves.toMatchObject({
      output: {
        matches: [
          {
            kind: "segment",
            path: "/knowledge/by-topic/segments.md",
            segmentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
            snippet: "alpha roadmap\n",
            startOffset: 6,
          },
        ],
        nextCursor: "0",
        truncated: true,
      },
    });
  });

  it("greps document view paths across bounded descendant pages", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-06-03T00:00:00.000Z",
    });
    const objects = new Map([
      ["objects/a.md", "alpha"],
      ["objects/b.md", "bravo"],
      ["objects/dify.md", "## dify插件说明\n\nprovider details"],
    ]);

    await Promise.all([
      createDocumentPath({
        assets,
        filename: "a.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
        objectKey: "objects/a.md",
        paths,
      }),
      createDocumentPath({
        assets,
        filename: "b.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
        objectKey: "objects/b.md",
        paths,
      }),
      createDocumentPath({
        assets,
        filename: "dify插件说明.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
        objectKey: "objects/dify.md",
        paths,
      }),
    ]);

    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {
        getObject: async (key: string) =>
          objects.has(key) ? new TextEncoder().encode(objects.get(key)) : null,
      },
      parseArtifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 10 }),
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: "/knowledge/docs",
          q: "插件说明",
        },
        name: "grep",
      }),
    ).resolves.toMatchObject({
      output: {
        matches: [
          {
            kind: "segment",
            path: "/knowledge/docs/dify插件说明.md--018f0d60",
            snippet: "## dify插件说明\n\nprovider details",
            startOffset: 7,
          },
        ],
        truncated: false,
      },
    });
  });

  it("finds document paths after nonmatching descendant pages", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-06-03T00:00:00.000Z",
    });

    await Promise.all([
      createDocumentPath({
        assets,
        filename: "a.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11",
        objectKey: "objects/a.md",
        paths,
      }),
      createDocumentPath({
        assets,
        filename: "b.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12",
        objectKey: "objects/b.md",
        paths,
      }),
      createDocumentPath({
        assets,
        filename: "dify插件说明.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e13",
        objectKey: "objects/dify.md",
        paths,
      }),
    ]);

    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      parseArtifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 10 }),
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          nameContains: "dify",
          path: "/knowledge/docs",
        },
        name: "find",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [
          {
            path: "/knowledge/docs/dify插件说明.md--018f0d60",
            resourceType: "document",
          },
        ],
        truncated: false,
      },
    });
  });

  it("writes and appends text documents under the docs view", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-06-03T00:00:00.000Z",
    });
    const objects = new Map<string, Uint8Array>();
    const objectWriteAdmissionEvents: string[] = [];
    const mutationLeaseEvents: string[] = [];
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const objectStorage = {
      getObject: async (key: string) => objects.get(key) ?? null,
      putObject: async ({
        body,
        key,
      }: {
        readonly body: Uint8Array;
        readonly key: string;
      }) => {
        objectWriteAdmissionEvents.push("put:start");
        objects.set(key, body);
        objectWriteAdmissionEvents.push("put:committed");

        return {
          key,
          metadata: {},
          sizeBytes: body.byteLength,
        };
      },
    } as PlatformAdapter["objectStorage"];
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets,
      compute: {} as ComputeRuntime,
      documentMutationAdmissionGuard: {
        acquireDocumentMutationLease: async (input) => {
          mutationLeaseEvents.push(`acquire:${input.operation}:${input.acquiredAt}`);
          return {
            ...input,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
          };
        },
        releaseDocumentMutationLease: async (lease) => {
          mutationLeaseEvents.push(`release:${lease.operation}:${lease.acquiredAt}`);
        },
      },
      documentMutationLeaseNow: () => "2026-07-14T12:00:00.000Z",
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectWriteAdmission: {
        withSpaceWriteAdmission: async (scope, write) => {
          expect(scope).toEqual({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" });
          objectWriteAdmissionEvents.push("admission:acquired");
          const result = await write();
          objectWriteAdmissionEvents.push("admission:released");
          return result;
        },
      },
      objectStorage,
      parseArtifacts,
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);
    const subject = {
      scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
      subjectId: "subject-1",
      tenantId: "tenant-1",
    };

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject,
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/docs/example.txt",
          text: "这是一行新文本\n",
        },
        name: "write",
      }),
    ).resolves.toMatchObject({
      output: {
        bytesWritten: expect.any(Number),
        mode: "write",
        path: "/knowledge/docs/example.txt",
      },
    });
    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject,
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/docs/example.txt",
          text: "追加写入\n",
        },
        name: "append",
      }),
    ).resolves.toMatchObject({
      output: {
        mode: "append",
        path: "/knowledge/docs/example.txt",
      },
    });
    expect(mutationLeaseEvents).toEqual([
      "acquire:knowledge-fs-write:2026-07-14T12:00:00.000Z",
      "release:knowledge-fs-write:2026-07-14T12:00:00.000Z",
      "acquire:knowledge-fs-write:2026-07-14T12:00:00.000Z",
      "release:knowledge-fs-write:2026-07-14T12:00:00.000Z",
    ]);
    expect(objectWriteAdmissionEvents).toEqual([
      "admission:acquired",
      "put:start",
      "put:committed",
      "admission:released",
      "admission:acquired",
      "put:start",
      "put:committed",
      "admission:released",
    ]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject,
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/docs/example.txt",
        },
        name: "cat",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/plain",
        text: "这是一行新文本\n追加写入\n",
        truncated: false,
      },
    });
    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-2",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/docs/read-only.txt",
          text: "blocked",
        },
        name: "write",
      }),
    ).rejects.toThrow("permission denied");
  });

  it("scrubs an object when a permanent deletion fence appears during KnowledgeFS write", async () => {
    const paths = createInMemoryKnowledgePathRepository({ maxListLimit: 10, maxPaths: 10 });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const objects = new Map<string, Uint8Array>();
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const objectStorage = {
      deleteObject: async (key: string) => {
        objects.delete(key);
      },
      putObject: async ({ body, key }: { readonly body: Uint8Array; readonly key: string }) => {
        objects.set(key, body);
        await fences.activateFence({
          id: "delete-fence-1",
          knowledgeSpaceId: SPACE_ID,
          targetId: SPACE_ID,
          targetType: "space",
          tenantId: "tenant-1",
        });
        return { key, metadata: {}, sizeBytes: body.byteLength };
      },
    } as PlatformAdapter["objectStorage"];
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets,
      compute: {} as ComputeRuntime,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage,
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:write"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          path: "/knowledge/docs/late.md",
          text: "late write",
        },
        name: "write",
      }),
    ).rejects.toMatchObject({ name: "DeletionLifecycleFenceActiveError" });
    expect(objects.size).toBe(0);
    await expect(assets.list({ knowledgeSpaceId: SPACE_ID, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
  });

  it("finds artifact segments by bounded metadata pages", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d22",
        knowledgeSpaceId: SPACE_ID,
        resourceType: "artifact",
        targetId: ARTIFACT_ID,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/findable.md",
      }),
    );
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    await artifactSegments.createMany({
      segments: [
        segment(0, "alpha", { metadata: { parseElementType: "paragraph" } }),
        segment(1, "bravo", { metadata: { parseElementType: "table" } }),
      ],
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 2 });
    await createOpenTestAsset(assets);
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments,
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    const result = await registry.execute({
      context: {
        resourceType: "workspace",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "subject-1",
          tenantId: "tenant-1",
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        metadataKey: "parseElementType",
        metadataValue: "paragraph",
        path: "/knowledge/by-topic/findable.md",
      },
      name: "find",
    });

    expect(result.output).toEqual({
      items: [
        {
          kind: "resource",
          metadata: {
            parseElementType: "paragraph",
            segmentIndex: 0,
            segmentType: "text",
          },
          name: "segment-0",
          path: "/knowledge/by-topic/findable.md#segment-0",
          resourceType: "artifact",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
        },
      ],
      path: "/knowledge/by-topic/findable.md",
      truncated: false,
    });
  });

  it("falls back to bounded legacy parse artifact elements when segments are absent", async () => {
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d23",
        knowledgeSpaceId: SPACE_ID,
        metadata: { contentType: "text/markdown" },
        resourceType: "artifact",
        targetId: ARTIFACT_ID,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/legacy.md",
      }),
    );
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "text",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        elements: [
          {
            id: "legacy-0",
            metadata: {},
            text: "legacy alpha\n",
            type: "paragraph",
          },
          {
            id: "legacy-1",
            metadata: {},
            text: "legacy bravo\n",
            type: "paragraph",
          },
        ],
        id: ARTIFACT_ID,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
    );
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 2 });
    await createOpenTestAsset(assets);
    const registry = createKnowledgeFsCommandRegistry({
      artifactSegments: createInMemoryArtifactSegmentRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxSegments: 10,
      }),
      assets,
      compute: {} as ComputeRuntime,
      graph: {},
      maxTreeDepth: 4,
      nodes: {},
      objectStorage: {} as PlatformAdapter["objectStorage"],
      parseArtifacts,
      paths,
    } as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);

    await expect(
      registry.execute({
        context: {
          resourceType: "workspace",
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "subject-1",
            tenantId: "tenant-1",
          },
        },
        input: {
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: "/knowledge/by-topic/legacy.md",
        },
        name: "cat",
      }),
    ).resolves.toMatchObject({
      output: {
        nextCursor: "0",
        text: "legacy alpha\n",
        truncated: true,
      },
    });
  });
});

async function createOpenTestAsset(
  assets: ReturnType<typeof createInMemoryDocumentAssetRepository>,
): Promise<void> {
  await assets.create({
    filename: "artifact.md",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    knowledgeSpaceId: SPACE_ID,
    mimeType: "text/markdown",
    objectKey: "tenant-1/spaces/artifact.md",
    sha256: "f".repeat(64),
    sizeBytes: 1,
  });
}

async function createDocumentPath({
  assets,
  filename,
  id,
  objectKey,
  paths,
}: {
  readonly assets: ReturnType<typeof createInMemoryDocumentAssetRepository>;
  readonly filename: string;
  readonly id: string;
  readonly objectKey: string;
  readonly paths: ReturnType<typeof createInMemoryKnowledgePathRepository>;
}) {
  const asset = await assets.create({
    filename,
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mimeType: "text/markdown",
    objectKey,
    sha256: "c".repeat(64),
    sizeBytes: 42,
  });

  await paths.create(
    KnowledgePathSchema.parse({
      id: id.replace("2e", "3e"),
      knowledgeSpaceId: SPACE_ID,
      metadata: {
        filename,
        mimeType: asset.mimeType,
        objectKey,
      },
      resourceType: "document",
      targetId: id,
      version: asset.version,
      viewName: "docs",
      viewType: "physical",
      virtualPath: `/knowledge/docs/${filename}--${id.replaceAll("-", "").slice(0, 8)}`,
    }),
  );
}

function segment(
  segmentIndex: number,
  inlineText: string,
  overrides: Partial<ReturnType<typeof ArtifactSegmentSchema.parse>> = {},
) {
  return ArtifactSegmentSchema.parse({
    artifactHash: "a".repeat(64),
    checksum: "b".repeat(64),
    contentEncoding: "utf-8",
    createdAt: "2026-05-27T10:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    id: `018f0d60-7a49-7cc2-9c1b-5b36f18f2d${String(segmentIndex).padStart(2, "0")}`,
    inlineText,
    knowledgeSpaceId: SPACE_ID,
    parseArtifactId: ARTIFACT_ID,
    segmentIndex,
    segmentType: "text",
    sourceLocation: {
      startOffset: segmentIndex * 10,
    },
    startOffset: segmentIndex * 10,
    ...overrides,
  });
}
