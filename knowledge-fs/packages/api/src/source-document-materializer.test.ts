import { randomUUID } from "node:crypto";

import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { type ObjectStorageAdapter, ParseArtifactSchema } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  DeletionLifecycleFenceActiveError,
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createInMemoryDocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { createDocumentOutlineBuilder } from "./document-outline-builder";
import { sha256Hex } from "./document-upload-utils";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";
import {
  type SourceDocumentMaterializerDeps,
  createSourceDocumentMaterializer,
} from "./source-document-materializer";
import { SOURCE_OPERATION_FAILURES } from "./source-operation-error";
import { createNoopTraceRecorder } from "./tracing";

const KS = "10000000-0000-4000-8000-000000000001";

function stub<T>(): T {
  return undefined as unknown as T;
}

function fixedAssetId(): () => string {
  let index = 1;

  return () => `00000000-0000-4000-8000-${(index++).toString(16).padStart(12, "0")}`;
}

describe("createSourceDocumentMaterializer", () => {
  it("persists and forwards the source permission scope into reindexing", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 10,
    });
    const projectionLifecycle: string[] = [];
    const admittedScopes: { knowledgeSpaceId: string; tenantId: string }[] = [];
    const reindexInputs: Array<{
      readonly permissionScope?: readonly string[] | undefined;
      readonly projectionStatus?: string | undefined;
    }> = [];
    const deps: SourceDocumentMaterializerDeps = {
      artifacts,
      artifactSegments: {
        createMany: async ({ segments }) => {
          projectionLifecycle.push("segments");
          return [...segments];
        },
      } as SourceDocumentMaterializerDeps["artifactSegments"],
      assets,
      documentMultimodalManifests: {
        ...multimodalManifests,
        upsert: async (manifest) => {
          projectionLifecycle.push("manifest");
          return multimodalManifests.upsert(manifest);
        },
      },
      documentParser: {
        kind: "native-markdown",
        parse: async (input) =>
          ParseArtifactSchema.parse({
            artifactHash: "a".repeat(64),
            contentType: "text",
            createdAt: "2026-07-03T00:00:00.000Z",
            documentAssetId: input.documentAssetId,
            elements: [
              {
                id: "heading-1",
                metadata: {},
                sectionPath: ["Restricted"],
                text: "Restricted content",
                type: "heading",
              },
            ],
            id: "30000000-0000-4000-8000-000000000001",
            metadata: {},
            parser: "native-markdown",
            version: input.version,
          }),
      },
      generateArtifactSegmentId: randomUUID,
      generateDocumentAssetId: fixedAssetId(),
      generateKnowledgePathId: randomUUID,
      knowledgePaths: {
        upsertMany: async (paths) => [...paths],
      } as SourceDocumentMaterializerDeps["knowledgePaths"],
      now: () => "2026-07-03T00:00:00.000Z",
      objectWriteAdmission: {
        withSpaceWriteAdmission: async (scope, write) => {
          admittedScopes.push({ ...scope });
          return write();
        },
      },
      objectStorage: {
        putObject: async () => ({}),
      } as unknown as ObjectStorageAdapter,
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: randomUUID,
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 1_000,
        now: () => "2026-07-03T00:00:00.000Z",
      }),
      outlines: {
        upsert: async (outline) => outline,
      } as SourceDocumentMaterializerDeps["outlines"],
      synchronousUploadReindexer: {
        failProjections: async (input) => {
          projectionLifecycle.push("fail");
          return input.projectionIds.length;
        },
        publishProjections: async (input) => {
          projectionLifecycle.push("publish");
          return input.projectionIds.length;
        },
        reindex: async (input) => {
          projectionLifecycle.push("reindex");
          reindexInputs.push(input);

          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionIds: ["projection-source-1"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      traces: createNoopTraceRecorder(),
    };
    const materializer = createSourceDocumentMaterializer(deps);

    await expect(
      materializer.materialize({
        documents: [
          {
            body: new TextEncoder().encode("# Restricted"),
            filename: "restricted.md",
            mimeType: "text/markdown",
          },
        ],
        knowledgeSpaceId: KS,
        permissionScope: ["team:security", "role:auditor"],
        sourceId: "20000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ documents: [{ filename: "restricted.md" }], failed: [] });

    expect(reindexInputs).toHaveLength(1);
    expect(reindexInputs[0]?.permissionScope).toEqual(["team:security", "role:auditor"]);
    expect(reindexInputs[0]?.projectionStatus).toBe("building");
    expect(projectionLifecycle).toEqual(["reindex", "manifest", "segments", "publish"]);
    expect(admittedScopes).toEqual([{ knowledgeSpaceId: KS, tenantId: "tenant-1" }]);
    const [asset] = (await assets.list({ knowledgeSpaceId: KS, limit: 10 })).items;
    expect(asset?.metadata.permissionScope).toEqual(["team:security", "role:auditor"]);
    expect(asset?.parserStatus).toBe("parsed");
    await expect(
      multimodalManifests.getByDocumentVersion({
        documentAssetId: asset?.id ?? "",
        version: 1,
      }),
    ).resolves.toMatchObject({
      documentAssetId: asset?.id,
      parseArtifactId: "30000000-0000-4000-8000-000000000001",
      version: 1,
    });
  });

  it("fails staged projections when segment persistence fails after reindexing", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const projectionLifecycle: string[] = [];
    const failedProjectionInputs: unknown[] = [];
    const deps: SourceDocumentMaterializerDeps = {
      artifacts,
      artifactSegments: {
        createMany: async () => {
          projectionLifecycle.push("segments");
          throw new Error("segments boom with credential-secret");
        },
      } as unknown as SourceDocumentMaterializerDeps["artifactSegments"],
      assets,
      documentMultimodalManifests: {
        upsert: async (manifest) => {
          projectionLifecycle.push("manifest");
          return manifest;
        },
      } as SourceDocumentMaterializerDeps["documentMultimodalManifests"],
      documentParser: {
        kind: "native-markdown",
        parse: async (input) =>
          ParseArtifactSchema.parse({
            artifactHash: "b".repeat(64),
            contentType: "text",
            createdAt: "2026-07-03T00:00:00.000Z",
            documentAssetId: input.documentAssetId,
            elements: [
              {
                id: "heading-1",
                metadata: {},
                sectionPath: ["Rejected"],
                text: "Rejected content",
                type: "heading",
              },
            ],
            id: "30000000-0000-4000-8000-000000000002",
            metadata: {},
            parser: "native-markdown",
            version: input.version,
          }),
      },
      generateArtifactSegmentId: randomUUID,
      generateDocumentAssetId: fixedAssetId(),
      generateKnowledgePathId: randomUUID,
      knowledgePaths: {
        upsertMany: async (paths) => [...paths],
      } as SourceDocumentMaterializerDeps["knowledgePaths"],
      now: () => "2026-07-03T00:00:00.000Z",
      objectStorage: {
        putObject: async () => ({}),
      } as unknown as ObjectStorageAdapter,
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: randomUUID,
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 1_000,
        now: () => "2026-07-03T00:00:00.000Z",
      }),
      outlines: {
        upsert: async (outline) => outline,
      } as SourceDocumentMaterializerDeps["outlines"],
      synchronousUploadReindexer: {
        failProjections: async (input) => {
          projectionLifecycle.push("fail");
          failedProjectionInputs.push(input);
          return input.projectionIds.length;
        },
        publishProjections: async () => {
          projectionLifecycle.push("publish");
          return 1;
        },
        reindex: async (input) => {
          projectionLifecycle.push(`reindex:${input.projectionStatus}`);
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionIds: ["projection-source-failed-1"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      traces: createNoopTraceRecorder(),
    };

    const result = await createSourceDocumentMaterializer(deps).materialize({
      documents: [
        {
          body: new TextEncoder().encode("# Rejected"),
          filename: "rejected.md",
          mimeType: "text/markdown",
        },
      ],
      knowledgeSpaceId: KS,
      permissionScope: ["team:security"],
      sourceId: "20000000-0000-4000-8000-000000000001",
      tenantId: "tenant-1",
    });

    expect(result).toEqual({
      documents: [],
      failed: [
        {
          code: SOURCE_OPERATION_FAILURES.documentMaterialization.code,
          error: SOURCE_OPERATION_FAILURES.documentMaterialization.message,
          filename: "rejected.md",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("credential-secret");
    expect(projectionLifecycle).toEqual(["reindex:building", "manifest", "segments", "fail"]);
    expect(failedProjectionInputs).toEqual([
      {
        knowledgeSpaceId: KS,
        projectionIds: ["projection-source-failed-1"],
      },
    ]);
    const [asset] = (await assets.list({ knowledgeSpaceId: KS, limit: 10 })).items;
    expect(asset?.parserStatus).toBe("failed");
  });

  it("isolates per-document failures: a parser error marks that asset failed and is reported", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 100 });
    const putKeys: string[] = [];
    const objectStorage = {
      putObject: async ({ key }: { key: string }) => {
        putKeys.push(key);
        return {};
      },
    } as unknown as ObjectStorageAdapter;
    const documentParser: ParserAdapter = {
      kind: "native-markdown",
      parse: async () => {
        throw new Error("parse boom with credential-secret");
      },
    };

    // Every dep after `parse` is unreached because parse is the first awaited step.
    const deps: SourceDocumentMaterializerDeps = {
      artifacts: stub(),
      artifactSegments: stub(),
      assets,
      documentMultimodalManifests: stub(),
      documentParser,
      generateArtifactSegmentId: () => "seg",
      generateDocumentAssetId: fixedAssetId(),
      generateKnowledgePathId: () => "path",
      knowledgePaths: stub(),
      now: () => "2026-07-03T00:00:00.000Z",
      objectStorage,
      outlineBuilder: stub(),
      outlines: stub(),
      synchronousUploadReindexer: null,
      traces: createNoopTraceRecorder(),
    };

    const materializer = createSourceDocumentMaterializer(deps);
    const encoder = new TextEncoder();
    const result = await materializer.materialize({
      documents: [
        { body: encoder.encode("# A"), filename: "a.md", mimeType: "text/markdown" },
        { body: encoder.encode("# B"), filename: "b.md", mimeType: "text/markdown" },
      ],
      knowledgeSpaceId: KS,
      permissionScope: ["team:security"],
      sourceId: "20000000-0000-4000-8000-000000000001",
      tenantId: "tenant-1",
    });

    expect(result.documents).toHaveLength(0);
    expect(result.failed).toEqual([
      {
        code: SOURCE_OPERATION_FAILURES.documentMaterialization.code,
        error: SOURCE_OPERATION_FAILURES.documentMaterialization.message,
        filename: "a.md",
      },
      {
        code: SOURCE_OPERATION_FAILURES.documentMaterialization.code,
        error: SOURCE_OPERATION_FAILURES.documentMaterialization.message,
        filename: "b.md",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("credential-secret");
    expect(putKeys).toHaveLength(2);

    // Both assets were created (with the source id) then marked failed.
    const listed = await assets.list({ knowledgeSpaceId: KS, limit: 10 });
    expect(listed.items).toHaveLength(2);
    expect(listed.items.every((asset) => asset.parserStatus === "failed")).toBe(true);
    expect(
      listed.items.every((asset) => asset.sourceId === "20000000-0000-4000-8000-000000000001"),
    ).toBe(true);
    expect(listed.items.map((asset) => asset.metadata.permissionScope)).toEqual([
      ["team:security"],
      ["team:security"],
    ]);
  });

  it("persists source ownership before put and scrubs it when deletion wins", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const sourceId = "20000000-0000-4000-8000-000000000001";
    const backingStorage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 64 });
    let writtenObjectKey = "";
    let pendingAssetWasDurableBeforePut = false;
    const deps: SourceDocumentMaterializerDeps = {
      artifacts: stub(),
      artifactSegments: stub(),
      assets,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      documentMultimodalManifests: stub(),
      documentParser: stub(),
      generateArtifactSegmentId: () => "segment",
      generateDocumentAssetId: fixedAssetId(),
      generateKnowledgePathId: () => "path",
      knowledgePaths: stub(),
      now: () => "2026-07-03T00:00:00.000Z",
      objectStorage: {
        ...backingStorage,
        putObject: async (input) => {
          writtenObjectKey = input.key;
          const pending = await assets.get({
            id: input.metadata?.assetId ?? "",
            knowledgeSpaceId: KS,
          });
          pendingAssetWasDurableBeforePut =
            pending?.sourceId === sourceId &&
            pending.objectKey === input.key &&
            pending.parserStatus === "pending";
          const stored = await backingStorage.putObject(input);
          await fences.activateFence({
            id: "fence-1",
            knowledgeSpaceId: KS,
            targetId: sourceId,
            targetType: "source",
            tenantId: "tenant-1",
          });
          return stored;
        },
      },
      outlineBuilder: stub(),
      outlines: stub(),
      synchronousUploadReindexer: null,
      traces: createNoopTraceRecorder(),
    };

    await expect(
      createSourceDocumentMaterializer(deps).materialize({
        documents: [
          {
            body: new TextEncoder().encode("# Stale"),
            filename: "stale.md",
            mimeType: "text/markdown",
          },
        ],
        knowledgeSpaceId: KS,
        permissionScope: [],
        sourceId,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
    await expect(assets.list({ knowledgeSpaceId: KS, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    expect(pendingAssetWasDurableBeforePut).toBe(true);
    expect(writtenObjectKey).not.toBe("");
    await expect(backingStorage.getObject(writtenObjectKey)).resolves.toBeNull();
  });

  it("leaves a source-scoped failed asset that makes a post-put crash object discoverable", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const sourceId = "20000000-0000-4000-8000-000000000001";
    const documentAssetId = "00000000-0000-4000-8000-000000000099";
    const backingStorage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 64 });
    let writtenObjectKey = "";
    const deps: SourceDocumentMaterializerDeps = {
      artifacts: stub(),
      artifactSegments: stub(),
      assets,
      documentMultimodalManifests: stub(),
      documentParser: stub(),
      generateArtifactSegmentId: () => "segment",
      generateDocumentAssetId: () => documentAssetId,
      generateKnowledgePathId: () => "path",
      knowledgePaths: stub(),
      now: () => "2026-07-03T00:00:00.000Z",
      objectStorage: {
        ...backingStorage,
        putObject: async (input) => {
          writtenObjectKey = input.key;
          await backingStorage.putObject(input);
          // A real process death is uncatchable. Throwing immediately after the durable put models
          // its persisted state while still letting this test inspect the ownership ledger.
          throw new Error("simulated crash after object commit");
        },
      },
      outlineBuilder: stub(),
      outlines: stub(),
      synchronousUploadReindexer: null,
      traces: createNoopTraceRecorder(),
    };

    await expect(
      createSourceDocumentMaterializer(deps).materialize({
        documents: [
          {
            body: new TextEncoder().encode("# Crash"),
            filename: "crash.md",
            mimeType: "text/markdown",
          },
        ],
        knowledgeSpaceId: KS,
        permissionScope: [],
        sourceId,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ documents: [], failed: [{ filename: "crash.md" }] });

    await expect(assets.get({ id: documentAssetId, knowledgeSpaceId: KS })).resolves.toMatchObject({
      objectKey: writtenObjectKey,
      parserStatus: "failed",
      sourceId,
    });
    await expect(backingStorage.getObject(writtenObjectKey)).resolves.not.toBeNull();
    expect(writtenObjectKey).toContain(`/documents/${documentAssetId}/`);
  });

  it("reuses one run-owned pending asset across retries without invoking the legacy compiler", async () => {
    const body = new TextEncoder().encode("# Durable");
    const ownership = {
      contentHash: await sha256Hex(body),
      itemKey: "provider-page-1",
      runId: "source-run-1",
    };
    const fixture = createWorkflowMaterializerFixture();
    const materializer = createSourceDocumentMaterializer(fixture.deps);
    const request = {
      documents: [{ body, filename: "durable.md", mimeType: "text/markdown" }],
      knowledgeSpaceId: KS,
      permissionScope: ["team:durable"],
      sourceId: fixture.sourceId,
      tenantId: "tenant-1",
      workflowExecution: {
        assertActive: async () => undefined,
        items: [ownership],
        signal: new AbortController().signal,
      },
    } as const;

    const first = await materializer.materialize(request);
    const second = await materializer.materialize(request);

    expect(second.documents[0]?.documentAssetId).toBe(first.documents[0]?.documentAssetId);
    expect(fixture.putKeys).toHaveLength(2);
    await expect(fixture.assets.list({ knowledgeSpaceId: KS, limit: 10 })).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: first.documents[0]?.documentAssetId,
          parserStatus: "pending",
        }),
      ],
    });
  });

  it.each(["permission revoked", "source workflow execution lease lost"])(
    "compensates the exact run-owned asset and object when %s after put",
    async (fenceFailure) => {
      const body = new TextEncoder().encode("# Revoked");
      const ownership = {
        contentHash: await sha256Hex(body),
        itemKey: "provider-page-revoked",
        runId: "source-run-revoked",
      };
      let allowed = true;
      const fixture = createWorkflowMaterializerFixture({
        afterPut: () => {
          allowed = false;
        },
      });

      await expect(
        createSourceDocumentMaterializer(fixture.deps).materialize({
          documents: [{ body, filename: "revoked.md", mimeType: "text/markdown" }],
          knowledgeSpaceId: KS,
          permissionScope: [],
          sourceId: fixture.sourceId,
          tenantId: "tenant-1",
          workflowExecution: {
            assertActive: async () => {
              if (!allowed) throw new Error(fenceFailure);
            },
            items: [ownership],
            signal: new AbortController().signal,
          },
        }),
      ).rejects.toThrow(fenceFailure);

      await expect(fixture.assets.list({ knowledgeSpaceId: KS, limit: 10 })).resolves.toMatchObject(
        { items: [] },
      );
      await expect(fixture.storage.getObject(fixture.putKeys[0] ?? "")).resolves.toBeNull();
      expect(fixture.scrubbedOwnerships).toEqual([ownership]);
    },
  );

  it("compensates a run-owned asset when object storage fails after committing the put", async () => {
    const body = new TextEncoder().encode("# Put failure");
    const ownership = {
      contentHash: await sha256Hex(body),
      itemKey: "provider-page-put-failure",
      runId: "source-run-put-failure",
    };
    const fixture = createWorkflowMaterializerFixture({ failAfterPut: true });

    await expect(
      createSourceDocumentMaterializer(fixture.deps).materialize({
        documents: [{ body, filename: "put-failure.md", mimeType: "text/markdown" }],
        knowledgeSpaceId: KS,
        permissionScope: [],
        sourceId: fixture.sourceId,
        tenantId: "tenant-1",
        workflowExecution: {
          assertActive: async () => undefined,
          items: [ownership],
          signal: new AbortController().signal,
        },
      }),
    ).resolves.toMatchObject({ documents: [], failed: [{ filename: "put-failure.md" }] });

    await expect(fixture.assets.list({ knowledgeSpaceId: KS, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    await expect(fixture.storage.getObject(fixture.putKeys[0] ?? "")).resolves.toBeNull();
    expect(fixture.scrubbedOwnerships).toEqual([ownership]);
  });
});

function createWorkflowMaterializerFixture(
  options: {
    readonly afterPut?: (() => void) | undefined;
    readonly failAfterPut?: boolean | undefined;
  } = {},
) {
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
  const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1_024 });
  const putKeys: string[] = [];
  const scrubbedOwnerships: unknown[] = [];
  const sourceId = "20000000-0000-4000-8000-000000000001";
  const deps: SourceDocumentMaterializerDeps = {
    artifacts: stub(),
    artifactSegments: stub(),
    assets,
    documentMultimodalManifests: stub(),
    documentParser: {
      kind: "native-markdown",
      parse: async () => {
        throw new Error("durable Source workflow invoked the legacy parser");
      },
    },
    generateArtifactSegmentId: randomUUID,
    generateDocumentAssetId: fixedAssetId(),
    generateKnowledgePathId: randomUUID,
    knowledgePaths: stub(),
    now: () => "2026-07-14T00:00:00.000Z",
    objectStorage: {
      ...storage,
      putObject: async (input) => {
        putKeys.push(input.key);
        const result = await storage.putObject(input);
        options.afterPut?.();
        if (options.failAfterPut) throw new Error("object store lost acknowledgement");
        return result;
      },
    },
    outlineBuilder: stub(),
    outlines: stub(),
    staleWriteScrubber: {
      scrub: async () => undefined,
      scrubOwned: async (input) => {
        scrubbedOwnerships.push(input.ownership);
        await assets.rollbackStaleWrite({
          expectedObjectKey: input.objectKey,
          expectedVersion: input.expectedVersion,
          id: input.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
        });
        await storage.deleteObject(input.objectKey);
        return true;
      },
    },
    synchronousUploadReindexer: null,
    traces: createNoopTraceRecorder(),
  };
  return { assets, deps, putKeys, scrubbedOwnerships, sourceId, storage };
}
