import {
  createMemoryCacheAdapter,
  createMemoryObjectStorageAdapter,
  createSchemaDatabaseAdapter,
} from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createDatabaseDurableDeletionTargetCapabilities } from "./database-durable-deletion-target-capabilities";
import type {
  DurableDeletionItemKind,
  DurableDeletionJob,
  DurableDeletionJobItem,
} from "./durable-deletion-repository";

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const targetDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const targetTraceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const unrelatedTraceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const targetBundleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04";
const targetNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05";
const targetProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d06";
const oldPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d07";
const newPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d08";

describe("database durable deletion target capabilities", () => {
  it("binds every TiDB durable-deletion capability query with one value per anonymous placeholder", async () => {
    const mismatches: string[] = [];
    const calls: Array<{
      readonly deleteMode: DurableDeletionJob["deleteMode"];
      readonly input: DatabaseExecuteInput;
      readonly targetType: DurableDeletionJob["targetType"];
    }> = [];
    let activeJob = job();
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push({ deleteMode: activeJob.deleteMode, input, targetType: activeJob.targetType });
      const placeholderCount = input.sql.match(/\?/gu)?.length ?? 0;
      if (placeholderCount !== input.params.length) {
        mismatches.push(
          `${input.operation}:${input.tableName}: placeholders=${placeholderCount}, params=${input.params.length}`,
        );
      }
      if (input.operation === "select" && input.tableName === "deletion_jobs") {
        return result([{ id: activeJob.id }]);
      }
      if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
        return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
      }
      return result([]);
    };
    const capabilities = capabilitiesFor("tidb", execute);
    const signal = new AbortController().signal;
    const jobs = [
      job({ targetId: spaceId, targetType: "knowledge_space" }),
      job({ targetId: targetDocumentId, targetType: "document_asset" }),
      job({ targetId: targetDocumentId, targetType: "logical_document" }),
      job({ deleteMode: "cascade", targetId: targetDocumentId, targetType: "source" }),
      job({ deleteMode: "keep", targetId: targetDocumentId, targetType: "source" }),
    ];

    for (const targetJob of jobs) {
      activeJob = targetJob;
      await capabilities.inventory({ job: targetJob, limit: 7, signal });
      await capabilities.excludeTargetFromPublishedHead({ job: targetJob, signal });
      await capabilities.quiesce({ job: targetJob, signal });
      await capabilities.deleteDerivedDataPage({ job: targetJob, limit: 7, signal });
      await capabilities.deletePrimaryData({
        job: targetJob,
        leaseFence: {
          deletionJobId: targetJob.id,
          expectedRowVersion: targetJob.rowVersion,
          leaseToken: targetJob.leaseToken as string,
        },
        signal,
        transaction: { execute },
      });
    }

    expect([...new Set(mismatches)]).toEqual([]);
    const sourceSecretLifecycle = calls.find(
      (call) =>
        call.targetType === "source" &&
        call.input.operation === "select" &&
        call.input.tableName === "source_secret_lifecycle_refs" &&
        call.input.sql.includes("state") &&
        call.input.sql.includes("deleted"),
    );
    expect(sourceSecretLifecycle?.input.params).toEqual([
      activeJob.tenantId,
      activeJob.knowledgeSpaceId,
      targetDocumentId,
      7,
    ]);
    const sourceCascadeOverview = calls.find(
      (call) =>
        call.targetType === "source" &&
        call.deleteMode === "cascade" &&
        call.input.operation === "select" &&
        call.input.tableName === "knowledge_space_attention_states",
    );
    expect(sourceCascadeOverview?.input.params).toEqual([
      activeJob.tenantId,
      activeJob.knowledgeSpaceId,
      targetDocumentId,
      activeJob.tenantId,
      activeJob.knowledgeSpaceId,
      targetDocumentId,
      7,
    ]);
    const leaseCancellation = calls.find(
      (call) =>
        call.targetType === "knowledge_space" &&
        call.input.operation === "update" &&
        call.input.tableName === "knowledge_fs_leases",
    );
    expect(leaseCancellation?.input.params).toEqual([
      expect.any(String),
      activeJob.tenantId,
      activeJob.knowledgeSpaceId,
      expect.any(String),
    ]);
    expect(leaseCancellation?.input.params[0]).toBe(leaseCancellation?.input.params[3]);
    const wholeSpaceOrphanBundle = calls.find(
      (call) =>
        call.targetType === "knowledge_space" &&
        call.input.operation === "select" &&
        call.input.tableName === "evidence_bundles" &&
        call.input.sql.includes("linked_trace"),
    );
    expect(wholeSpaceOrphanBundle?.input.sql).toContain("target_space_document");
    expect(wholeSpaceOrphanBundle?.input.params).toEqual([
      activeJob.knowledgeSpaceId,
      activeJob.knowledgeSpaceId,
      activeJob.knowledgeSpaceId,
      7,
    ]);
    const wholeSpaceResearchPartial = calls.find(
      (call) =>
        call.targetType === "knowledge_space" &&
        call.input.operation === "select" &&
        call.input.tableName === "research_task_partial_results" &&
        call.input.sql.includes("target_research_partial") &&
        call.input.sql.includes("ORDER BY"),
    );
    expect(wholeSpaceResearchPartial?.input.sql).toContain("1 = 1");
    expect(wholeSpaceResearchPartial?.input.params).toEqual([activeJob.knowledgeSpaceId, 7]);
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`rejects a stale deletion worker before quiesce or derived cleanup can mutate (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const cache = createMemoryCacheAdapter({ maxEntries: 10 });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache,
        database,
        objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1024 }),
        secretStore: { delete: vi.fn(async () => undefined) },
      });

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job({ leaseToken: "stale-token" }),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("lease fence lost");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ operation: "select", tableName: "deletion_jobs" });
      expect(calls[0]?.params).toEqual([job().id, job().rowVersion, "stale-token"]);

      calls.length = 0;
      await expect(
        capabilities.quiesce({
          job: job({ leaseToken: "stale-token" }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("lease fence lost");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ operation: "select", tableName: "deletion_jobs" });
      await expect(cache.stats()).resolves.toMatchObject({ entries: 0 });
    });

    it(`fails closed for malformed inventory cursors and incomplete external items (${dialect})`, async () => {
      const capabilities = capabilitiesFor(dialect, async () => result([]));
      const signal = new AbortController().signal;
      const cursor = (value: Record<string, unknown>) =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

      await expect(
        capabilities.inventory({
          job: job({ deleteMode: "keep", targetType: "source" }),
          limit: 1,
          signal,
        }),
      ).resolves.toMatchObject({ complete: false, scanPhase: "source_secrets" });
      await expect(
        capabilities.inventory({
          cursor: cursor({ ordinal: 1, phase: "secrets" }),
          job: job({ deleteMode: "keep", targetType: "source" }),
          limit: 1,
          signal,
        }),
      ).resolves.toMatchObject({ complete: false, scanPhase: "source_secrets" });

      for (const invalidCursor of [
        "x".repeat(1_025),
        cursor({ ordinal: 0, phase: "document_objects" }),
        cursor({ ordinal: 1, phase: "unknown" }),
        cursor({ activeDocumentId: "", ordinal: 1, phase: "document_objects" }),
        cursor({ documentScan: "unknown", ordinal: 1, phase: "document_objects" }),
        cursor({ manifestKeyOffset: -1, ordinal: 1, phase: "document_objects" }),
      ]) {
        await expect(
          capabilities.inventory({ cursor: invalidCursor, job: job(), limit: 1, signal }),
        ).rejects.toThrow("inventory cursor is invalid");
      }

      await expect(
        capabilities.executeExternalItem({ item: deletionItem("object"), job: job(), signal }),
      ).rejects.toThrow("has no object key");
      await expect(
        capabilities.executeExternalItem({ item: deletionItem("secret_ref"), job: job(), signal }),
      ).rejects.toThrow("secret item is incomplete");
      await expect(
        capabilities.executeExternalItem({ item: deletionItem("cache_key"), job: job(), signal }),
      ).rejects.toThrow("has no cache key");
    });

    it(`rejects legacy local credential residue in Dify-managed mode (${dialect})`, async () => {
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        credentialMode: "dify-managed",
        database: createSchemaDatabaseAdapter({
          executor: async () => result([]),
          kind: dialect,
        }),
        objectStorage: createMemoryObjectStorageAdapter({
          kind: "memory",
          maxObjectBytes: 1_024,
        }),
      });

      await expect(
        capabilities.executeExternalItem({
          item: deletionItem("secret_ref", {
            credentialRef: "source-secret:v1:legacy",
            resourceId: targetDocumentId,
          }),
          job: job(),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("legacy KnowledgeFS-managed source credential cleanup");
    });

    it(`resumes bounded document object inventory across database, manifest, and storage phases (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const artifactKey = `${prefix}/documents/${targetDocumentId}/artifact.json`;
      const stagedKey = `${prefix}/documents/${targetDocumentId}/staged.json`;
      const manifestKey = `${prefix}/documents/${targetDocumentId}/image.png`;
      const variantKey = `${prefix}/documents/${targetDocumentId}/thumbnail.png`;
      const storageKey = `${prefix}/documents/${targetDocumentId}/storage.bin`;
      const manifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d20";
      const calls: DatabaseExecuteInput[] = [];
      let manifestCalls = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: prefix }]);
        }
        if (input.tableName === "artifact_segments") {
          return result([{ object_key: artifactKey }]);
        }
        if (input.tableName === "knowledge_space_staged_commits") {
          return result([{ object_key: stagedKey }]);
        }
        if (input.tableName === "document_multimodal_manifests") {
          manifestCalls += 1;
          if (manifestCalls === 3) return result([]);
          return result([
            {
              id: manifestId,
              items: [
                {
                  assetRef: {
                    objectKey: manifestKey,
                    variants: { thumbnail: { objectKey: variantKey } },
                  },
                  enrichment: {
                    asset: "provided",
                    caption: "missing",
                    ocr: "missing",
                    tableStructure: "missing",
                    visualEmbedding: "missing",
                  },
                  id: "image-1",
                  modality: "image",
                  parseElementId: "element-1",
                  sourceMetadata: {},
                },
              ],
            },
          ]);
        }
        return result([]);
      };
      const objectStorage = createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1_024,
      });
      await objectStorage.putObject({ body: new Uint8Array([1]), key: storageKey });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const documentJob = job();
      const signal = new AbortController().signal;

      const raw = await capabilities.inventory({ job: documentJob, limit: 2, signal });
      expect(raw).toMatchObject({ complete: false, items: [], scanPhase: "document_objects" });

      const artifacts = await capabilities.inventory({
        cursor: raw.nextCursor,
        job: documentJob,
        limit: 2,
        signal,
      });
      expect(artifacts.items).toEqual([
        expect.objectContaining({ kind: "object", objectKey: artifactKey, ordinal: 1 }),
      ]);

      const staged = await capabilities.inventory({
        cursor: artifacts.nextCursor,
        job: documentJob,
        limit: 2,
        signal,
      });
      expect(staged.items).toEqual([
        expect.objectContaining({ kind: "object", objectKey: stagedKey, ordinal: 2 }),
      ]);

      const firstManifest = await capabilities.inventory({
        cursor: staged.nextCursor,
        job: documentJob,
        limit: 1,
        signal,
      });
      const secondManifest = await capabilities.inventory({
        cursor: firstManifest.nextCursor,
        job: documentJob,
        limit: 1,
        signal,
      });
      expect([...firstManifest.items, ...secondManifest.items]).toEqual([
        expect.objectContaining({ kind: "object", objectKey: manifestKey, ordinal: 3 }),
        expect.objectContaining({ kind: "object", objectKey: variantKey, ordinal: 4 }),
      ]);

      const manifestsComplete = await capabilities.inventory({
        cursor: secondManifest.nextCursor,
        job: documentJob,
        limit: 2,
        signal,
      });
      expect(manifestsComplete.items).toEqual([]);

      const storage = await capabilities.inventory({
        cursor: manifestsComplete.nextCursor,
        job: documentJob,
        limit: 2,
        signal,
      });
      expect(storage.items).toEqual([
        expect.objectContaining({ kind: "object", objectKey: storageKey, ordinal: 5 }),
      ]);

      await expect(
        capabilities.inventory({
          cursor: storage.nextCursor,
          job: documentJob,
          limit: 2,
          signal,
        }),
      ).resolves.toEqual({ complete: true, items: [], scanPhase: "document_objects:6" });
      const manifestDatabaseCalls = calls.filter(
        (call) => call.tableName === "document_multimodal_manifests",
      );
      expect(manifestDatabaseCalls).toHaveLength(3);
      expect(manifestDatabaseCalls[0]?.params).toEqual(
        dialect === "postgres"
          ? ["tenant-a", spaceId, targetDocumentId]
          : [spaceId, targetDocumentId, "tenant-a", spaceId],
      );
      expect(manifestDatabaseCalls[0]?.sql).not.toContain(
        dialect === "postgres" ? 'manifest."id" >' : "manifest.`id` >",
      );
    });

    it(`deletes upload-session source objects from the reserved namespace (${dialect})`, async () => {
      const manifestPrefix = `tenant-a/spaces/${spaceId}`;
      const uploadObjectKey = `namespaces/tenant-a/spaces/${spaceId}/uploads/018f0d60-7a49-7cc2-9c1b-5b36f18f2d21/source`;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: manifestPrefix }]);
        }
        if (input.tableName === "document_assets" && input.sql.includes("object_key")) {
          return result([{ object_key: uploadObjectKey }]);
        }
        if (input.tableName === "document_assets") {
          return result([{ id: targetDocumentId }]);
        }
        return result([]);
      };
      const objectStorage = createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1_024,
      });
      await objectStorage.putObject({ body: new Uint8Array([1]), key: uploadObjectKey });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const logicalDocumentJob = job({ targetType: "logical_document" });
      const signal = new AbortController().signal;

      const inventory = await capabilities.inventory({
        job: logicalDocumentJob,
        limit: 1,
        signal,
      });
      expect(inventory.items).toEqual([
        expect.objectContaining({ kind: "object", objectKey: uploadObjectKey }),
      ]);

      await capabilities.executeExternalItem({
        item: deletionItem("object", { objectKey: uploadObjectKey }),
        job: logicalDocumentJob,
        signal,
      });
      await expect(objectStorage.headObject(uploadObjectKey)).resolves.toBeNull();

      await expect(
        capabilities.executeExternalItem({
          item: deletionItem("object", {
            objectKey:
              "namespaces/tenant-a/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/uploads/session/source",
          }),
          job: logicalDocumentJob,
          signal,
        }),
      ).rejects.toThrow("escapes the immutable space prefix");
    });

    it(`inventories and executes space objects, lifecycle secrets, source secrets, and cache items (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const firstObjectKey = `${prefix}/a.bin`;
      const secondObjectKey = `${prefix}/b.bin`;
      const lifecycleRef = "secret:lifecycle";
      const sourceRef = "secret:source";
      const sourceForSecret = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d30";
      const lifecycleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31";
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: prefix }]);
        }
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return result([
            { credential_ref: lifecycleRef, id: lifecycleId, source_id: sourceForSecret },
          ]);
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return result([{ credential_ref: sourceRef, id: sourceForSecret }]);
        }
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const cache = createMemoryCacheAdapter({ maxEntries: 10 });
      const objectStorage = createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1_024,
      });
      await objectStorage.putObject({ body: new Uint8Array([1]), key: firstObjectKey });
      await objectStorage.putObject({ body: new Uint8Array([2]), key: secondObjectKey });
      const deleteSecret = vi.fn(async () => undefined);
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache,
        database,
        objectStorage,
        secretStore: { delete: deleteSecret },
      });
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });
      const signal = new AbortController().signal;

      const firstObjects = await capabilities.inventory({ job: spaceJob, limit: 1, signal });
      const secondObjects = await capabilities.inventory({
        cursor: firstObjects.nextCursor,
        job: spaceJob,
        limit: 1,
        signal,
      });
      expect([...firstObjects.items, ...secondObjects.items].map((item) => item.objectKey)).toEqual(
        [firstObjectKey, secondObjectKey],
      );

      const lifecycleSecrets = await capabilities.inventory({
        cursor: secondObjects.nextCursor,
        job: spaceJob,
        limit: 2,
        signal,
      });
      expect(lifecycleSecrets.items).toEqual([
        expect.objectContaining({
          credentialRef: lifecycleRef,
          kind: "secret_ref",
          resourceId: sourceForSecret,
        }),
      ]);
      const sourceSecrets = await capabilities.inventory({
        cursor: lifecycleSecrets.nextCursor,
        job: spaceJob,
        limit: 2,
        signal,
      });
      expect(sourceSecrets).toMatchObject({
        complete: true,
        items: [
          expect.objectContaining({
            credentialRef: sourceRef,
            kind: "secret_ref",
            resourceId: sourceForSecret,
          }),
        ],
        scanPhase: "source_secrets",
      });
      expect(
        calls.find((call) => call.operation === "select" && call.tableName === "sources")?.sql,
      ).toContain(dialect === "postgres" ? `"credential_ref" <> ''` : "`credential_ref` <> ''");
      expect(
        calls.find(
          (call) =>
            call.operation === "select" && call.tableName === "source_secret_lifecycle_refs",
        )?.params,
      ).toEqual(["tenant-a", spaceId, null, 2]);
      expect(
        calls.find((call) => call.operation === "select" && call.tableName === "sources")?.params,
      ).toEqual(
        dialect === "postgres"
          ? ["tenant-a", spaceId, null, 2]
          : [spaceId, null, "tenant-a", spaceId, "tenant-a", spaceId, 2],
      );

      await capabilities.executeExternalItem({
        item: deletionItem("object", { objectKey: firstObjectKey }),
        job: spaceJob,
        signal,
      });
      await expect(objectStorage.getObject(firstObjectKey)).resolves.toBeNull();

      await capabilities.executeExternalItem({
        item: deletionItem("secret_ref", {
          credentialRef: lifecycleRef,
          resourceId: sourceForSecret,
        }),
        job: spaceJob,
        signal,
      });
      expect(deleteSecret).toHaveBeenCalledWith({
        knowledgeSpaceId: spaceId,
        ref: lifecycleRef,
        sourceId: sourceForSecret,
        tenantId: spaceJob.tenantId,
      });
      expect(
        calls.some(
          (call) =>
            call.operation === "update" && call.tableName === "source_secret_lifecycle_refs",
        ),
      ).toBe(true);

      await cache.set("deletion:cache-key", new Uint8Array([3]));
      await capabilities.executeExternalItem({
        item: deletionItem("cache_key", { cacheKey: "deletion:cache-key" }),
        job: spaceJob,
        signal,
      });
      await expect(cache.get("deletion:cache-key")).resolves.toBeNull();

      for (const kind of ["document_cascade", "document_detach"] as const) {
        await expect(
          capabilities.executeExternalItem({
            item: deletionItem(kind),
            job: spaceJob,
            signal,
          }),
        ).rejects.toThrow("must execute atomically");
      }
    });

    it(`uses a nullable UUID cursor for the first document inventory page (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const capabilities = capabilitiesFor(dialect, async (input) => {
        calls.push(input);
        return result([]);
      });

      await capabilities.inventory({
        job: job({ targetType: "source" }),
        limit: 2,
        signal: new AbortController().signal,
      });

      const documentCall = calls.find(
        (call) => call.operation === "select" && call.tableName === "document_assets",
      );
      expect(documentCall?.params).toEqual([spaceId, null, targetDocumentId]);
      expect(documentCall?.sql).toContain("COALESCE");
    });

    it(`publishes a target-free, graph-closed head while preserving unrelated Deep members (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      let targetProbeCount = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          return result([
            {
              fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
              head_revision: 11,
              projection_version: 4,
              publication_id: oldPublicationId,
            },
          ]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_members"
        ) {
          if (input.sql.includes("validated_graph_member")) return result([]);
          targetProbeCount += 1;
          return targetProbeCount === 1 ? result([{ component_key: targetBundleId }]) : result([]);
        }
        if (
          input.operation === "update" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          input.operation === "insert" &&
          input.tableName === "knowledge_space_profile_publication_bindings"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute, newPublicationId);

      await expect(
        capabilities.excludeTargetFromPublishedHead({
          job: job(),
          signal: new AbortController().signal,
        }),
      ).resolves.toBeUndefined();

      const memberInserts = calls.filter(
        (call) =>
          call.operation === "insert" && call.tableName === "projection_set_publication_members",
      );
      expect(memberInserts).toHaveLength(3);
      expect(memberInserts.every((call) => call.params[0] === newPublicationId)).toBe(true);
      expect(memberInserts.every((call) => call.params.includes(oldPublicationId))).toBe(true);
      expect(memberInserts[0]?.sql).toContain("NOT IN ('graph-entity', 'graph-relation')");
      expect(memberInserts[0]?.sql).toContain("document_asset_id");
      const profileBindingInsert = calls.find(
        (call) =>
          call.operation === "insert" &&
          call.tableName === "knowledge_space_profile_publication_bindings",
      );
      expect(profileBindingInsert?.sql).toContain("content-publication");
      expect(profileBindingInsert?.params).toEqual(
        dialect === "postgres"
          ? [
              newPublicationId,
              expect.stringMatching(/^projection-set-sha256:/u),
              expect.any(String),
              job().tenantId,
              job().knowledgeSpaceId,
              oldPublicationId,
            ]
          : [
              newPublicationId,
              newPublicationId,
              expect.stringMatching(/^projection-set-sha256:/u),
              expect.any(String),
              expect.any(String),
              job().tenantId,
              job().knowledgeSpaceId,
              oldPublicationId,
            ],
      );

      const entityCopy = memberInserts[1]?.sql ?? "";
      expect(entityCopy).toContain("graph-entity");
      expect(entityCopy).toContain("candidate_graph_entity");
      expect(entityCopy).toContain("visible_projection_node");
      expect(entityCopy).toContain("index_projections");
      expect(entityCopy).toContain("lifecycle_state");
      expect(entityCopy).toContain("active");
      expect(entityCopy).toContain("SELECT DISTINCT");
      expect(entityCopy).toContain("GROUP BY");
      expect(entityCopy).toContain("HAVING SUM(CASE WHEN");
      expect(entityCopy).toContain(
        dialect === "postgres" ? "jsonb_array_elements_text" : "JSON_TABLE",
      );
      expect(entityCopy).not.toContain("NOT EXISTS (SELECT 1 FROM");

      const relationCopy = memberInserts[2]?.sql ?? "";
      expect(relationCopy).toContain("graph-relation");
      expect(relationCopy).toContain("subject_entity_id");
      expect(relationCopy).toContain("object_entity_id");
      expect(relationCopy).toContain("subject_entity_member");
      expect(relationCopy).toContain("object_entity_member");
      expect(relationCopy).toContain("GROUP BY");
      expect(relationCopy).not.toContain("NOT EXISTS (SELECT 1 FROM");

      const targetProbes = calls.filter(
        (call) =>
          call.operation === "select" &&
          call.tableName === "projection_set_publication_members" &&
          !call.sql.includes("validated_graph_member"),
      );
      expect(targetProbes).toHaveLength(2);
      for (const probe of targetProbes) {
        // NULL/misattributed graph owners are still caught through their source node -> document.
        expect(probe.sql).toContain("graph_entities");
        expect(probe.sql).toContain("graph_relations");
        expect(probe.sql).toContain("target_source_node");
        expect(probe.params).toContain(targetDocumentId);
      }
      const invalidProbe = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "projection_set_publication_members" &&
          call.sql.includes("validated_graph_member"),
      );
      expect(invalidProbe?.sql).toContain("UNION ALL");
      expect(invalidProbe?.sql).toContain("validated_visible_projection_node");
      expect(invalidProbe?.sql).toContain("HAVING");
      expect(invalidProbe?.sql).not.toContain("NOT (EXISTS");
    });

    it(`fails closed when the deletion publication contains a dangling graph member (${dialect})`, async () => {
      let targetProbeCount = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          return result([
            {
              fingerprint: `projection-set-sha256:${"c".repeat(64)}`,
              head_revision: 12,
              projection_version: 4,
              publication_id: oldPublicationId,
            },
          ]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_members"
        ) {
          if (input.sql.includes("validated_graph_member")) {
            return result([{ component_key: targetBundleId }]);
          }
          targetProbeCount += 1;
          return targetProbeCount === 1 ? result([{ component_key: targetBundleId }]) : result([]);
        }
        if (
          input.operation === "update" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          input.operation === "insert" &&
          input.tableName === "knowledge_space_profile_publication_bindings"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute, newPublicationId);

      await expect(
        capabilities.excludeTargetFromPublishedHead({
          job: job(),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("publication graph closure residual probe failed");
    });

    it(`publishes one idempotent sanitized successor for source keep without mutating immutable metadata (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      let currentPublicationId = oldPublicationId;
      let currentFingerprint = `projection-set-sha256:${"d".repeat(64)}`;
      let currentMetadata: Record<string, unknown> = {
        fingerprintMaterial: {
          sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          sourceSnapshots: [{ documentAssetId: targetDocumentId }],
        },
      };
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          return result([
            {
              fingerprint: currentFingerprint,
              head_revision: currentPublicationId === oldPublicationId ? 7 : 8,
              metadata: currentMetadata,
              projection_version: 4,
              publication_id: currentPublicationId,
            },
          ]);
        }
        if (input.operation === "insert" && input.tableName === "projection_set_publications") {
          currentFingerprint = String(input.params[3]);
          currentMetadata = JSON.parse(String(input.params[6])) as Record<string, unknown>;
          return { rows: [], rowsAffected: 1 };
        }
        if (
          input.operation === "update" &&
          input.tableName === "projection_set_publication_heads"
        ) {
          currentPublicationId = String(input.params[0]);
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      };
      const capabilities = capabilitiesFor(dialect, execute, newPublicationId);
      const sourceKeepJob = job({
        deleteMode: "keep",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
        targetType: "source",
      });

      await capabilities.excludeTargetFromPublishedHead({
        job: sourceKeepJob,
        signal: new AbortController().signal,
      });
      await capabilities.excludeTargetFromPublishedHead({
        job: sourceKeepJob,
        signal: new AbortController().signal,
      });

      const publicationInserts = calls.filter(
        (call) => call.operation === "insert" && call.tableName === "projection_set_publications",
      );
      expect(publicationInserts).toHaveLength(1);
      expect(currentMetadata).toEqual({
        deletionJobId: sourceKeepJob.id,
        retainedDocuments: true,
        sourceIdentityScrubbed: true,
      });
      const memberCopies = calls.filter(
        (call) =>
          call.operation === "insert" && call.tableName === "projection_set_publication_members",
      );
      expect(memberCopies).toHaveLength(1);
      expect(memberCopies[0]?.sql).not.toContain("document_asset_id NOT IN");
      expect(
        calls.filter(
          (call) =>
            call.operation === "insert" &&
            call.tableName === "knowledge_space_profile_publication_bindings",
        ),
      ).toHaveLength(1);
      expect(
        calls.some(
          (call) =>
            call.operation === "update" &&
            call.tableName === "projection_set_publications" &&
            call.sql.includes('SET "metadata"'),
        ),
      ).toBe(false);
    });

    it(`preserves AnswerTrace evidence history for every subresource target (${dialect})`, async () => {
      for (const deletionJob of [
        job(),
        job({ targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10", targetType: "source" }),
        job({ targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11", targetType: "logical_document" }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "deletion_jobs") {
            return result([{ id: deletionJob.id }]);
          }
          if (input.operation === "select" && input.tableName === "answer_traces") {
            return result([{ evidence_bundle_id: null, id: targetTraceId }]);
          }
          if (
            input.operation === "select" &&
            (input.tableName === "research_task_jobs" ||
              input.tableName === "research_task_partial_results")
          ) {
            return result([{ id: "retained-research-history" }]);
          }
          return result([]);
        };
        const capabilities = capabilitiesFor(dialect, execute);

        await expect(
          capabilities.deleteDerivedDataPage({
            job: deletionJob,
            limit: 10,
            signal: new AbortController().signal,
          }),
        ).resolves.toEqual({ complete: true, deleted: 0 });

        expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
        expect(calls.some((call) => call.tableName === "answer_trace_steps")).toBe(false);
        expect(calls.some((call) => call.tableName === "evidence_bundles")).toBe(false);
        expect(calls.some((call) => call.tableName.startsWith("research_task_"))).toBe(false);
        expect(calls.some((call) => call.tableName === "retrieval_execution_leases")).toBe(false);
      }
    });

    it(`does not treat retained subresource AnswerTrace or Research history as deletion residue (${dialect})`, async () => {
      for (const deletionJob of [
        job(),
        job({
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          targetType: "source",
        }),
        job({
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
          targetType: "logical_document",
        }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "deletion_jobs") {
            return result([{ id: deletionJob.id }]);
          }
          if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
            return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
          }
          if (input.operation === "select" && input.tableName === "answer_traces") {
            return result([{ id: targetTraceId }]);
          }
          if (
            input.operation === "select" &&
            (input.tableName === "research_task_jobs" ||
              input.tableName === "research_task_partial_results")
          ) {
            return result([{ id: "retained-research-history" }]);
          }
          return result([]);
        };
        const capabilities = capabilitiesFor(dialect, execute);

        await expect(
          capabilities.deletePrimaryData({
            job: deletionJob,
            leaseFence: {
              deletionJobId: deletionJob.id,
              expectedRowVersion: deletionJob.rowVersion,
              leaseToken: deletionJob.leaseToken as string,
            },
            signal: new AbortController().signal,
            transaction: { execute },
          }),
        ).resolves.toEqual({ clean: true });

        expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
        expect(calls.some((call) => call.tableName === "evidence_bundles")).toBe(false);
        expect(calls.some((call) => call.tableName.startsWith("research_task_"))).toBe(false);
        expect(calls.some((call) => call.tableName === "retrieval_execution_leases")).toBe(false);
      }
    });

    it(`physically removes AnswerTrace history only for knowledge-space deletion (${dialect})`, async () => {
      const remainingTraceIds = new Set([targetTraceId, unrelatedTraceId]);
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "answer_traces") {
          return result([
            { evidence_bundle_id: targetBundleId, id: targetTraceId },
            { evidence_bundle_id: null, id: unrelatedTraceId },
          ]);
        }
        if (input.operation === "select" && input.tableName === "evidence_bundles") {
          return result([{ id: targetBundleId }]);
        }
        if (input.operation === "delete" && input.tableName === "answer_traces") {
          for (const id of input.params) {
            if (typeof id === "string") remainingTraceIds.delete(id);
          }
        }
        return result([]);
      };

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: job({ targetId: spaceId, targetType: "knowledge_space" }),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 2 });

      expect(remainingTraceIds).toEqual(new Set());
      expect(
        calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
      ).toEqual(["failed_queries", "answer_trace_steps", "answer_traces", "evidence_bundles"]);
    });

    it(`keeps source deletion from inspecting retained Research or AnswerTrace history (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);
      const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10";

      await capabilities.deleteDerivedDataPage({
        job: job({ deleteMode: "cascade", targetId: sourceId, targetType: "source" }),
        limit: 7,
        signal: new AbortController().signal,
      });
      expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
      expect(calls.some((call) => call.tableName.startsWith("research_task_"))).toBe(false);

      calls.length = 0;
      await expect(
        capabilities.deleteDerivedDataPage({
          job: job({ deleteMode: "keep", targetId: sourceId, targetType: "source" }),
          limit: 7,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: true, deleted: 0 });
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "agent_workspace_snapshots",
        ),
      ).toBe(false);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "knowledge_fs_sessions",
        ),
      ).toBe(false);
      expect(calls.some((call) => call.tableName === "golden_questions")).toBe(false);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "research_task_jobs",
        ),
      ).toBe(false);
      expect(
        calls.some((call) => call.operation === "select" && call.tableName === "resource_mounts"),
      ).toBe(false);
      const sourcePath = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "knowledge_paths" &&
          call.sql.includes("resource_type") &&
          call.sql.includes("source"),
      );
      expect(sourcePath?.params).toEqual(
        dialect === "postgres" ? [spaceId, sourceId, 7] : [spaceId, sourceId, sourceId, 7],
      );
      const retainedMetadata = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "document_assets" &&
          call.sql.includes("sourceId"),
      );
      expect(retainedMetadata?.sql).toContain("credentialRef");
      expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
    });

    it(`preserves the original derived-cleanup error when the transaction is aborted (${dialect})`, async () => {
      let fenceChecks = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          fenceChecks += 1;
          if (fenceChecks > 1) throw new Error("transaction aborted");
          return result([{ id: job().id }]);
        }
        if (input.operation === "select" && input.tableName === "golden_questions") {
          throw new Error("golden question cleanup failed");
        }
        return result([]);
      };

      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage: createMemoryObjectStorageAdapter({
          kind: "memory",
          maxObjectBytes: 1_024,
        }),
        secretStore: { delete: vi.fn(async () => undefined) },
      });

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job({ targetId: spaceId, targetType: "knowledge_space" }),
          limit: 7,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("golden question cleanup failed");
      expect(fenceChecks).toBe(1);
    });

    it(`source keep does not cancel or drain whole-space Research writers (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "research_task_jobs" &&
          input.sql.includes("lease_expires_at")
        ) {
          return result([{ id: "live-research" }]);
        }
        return result([]);
      };
      const deletionJob = job({
        deleteMode: "keep",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
        targetType: "source",
      });

      await expect(
        capabilitiesFor(dialect, execute).quiesce({
          job: deletionJob,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ drained: true });

      expect(
        calls.some(
          (call) => call.operation === "update" && call.tableName === "research_task_jobs",
        ),
      ).toBe(false);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "research_task_jobs",
        ),
      ).toBe(false);
      expect(calls.some((call) => call.tableName === "document_compilation_attempts")).toBe(false);
    });

    it(`removes completed source-secret ledgers even when source documents are kept (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const lifecycleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return result([{ id: lifecycleId }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job({ deleteMode: "keep", targetId: "source-a", targetType: "source" }),
          limit: 5,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });
      expect(calls.find((call) => call.operation === "delete")).toMatchObject({
        operation: "delete",
        params: [lifecycleId],
        tableName: "source_secret_lifecycle_refs",
      });
      expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
    });

    it(`restores only this source keep job's hidden children before detaching them (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);
      const sourceKeepJob = job({
        deleteMode: "keep",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
        targetType: "source",
      });

      await expect(
        capabilities.deletePrimaryData({
          job: sourceKeepJob,
          leaseFence: {
            deletionJobId: sourceKeepJob.id,
            expectedRowVersion: sourceKeepJob.rowVersion,
            leaseToken: sourceKeepJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });

      const childUpdates = calls.filter(
        (call) => call.operation === "update" && call.tableName === "document_assets",
      );
      expect(childUpdates).toHaveLength(2);
      expect(childUpdates[0]?.params).toEqual(
        dialect === "postgres"
          ? [spaceId, sourceKeepJob.targetId, sourceKeepJob.id, sourceKeepJob.updatedAt]
          : [sourceKeepJob.updatedAt, spaceId, sourceKeepJob.targetId, sourceKeepJob.id],
      );
      expect(childUpdates[0]?.sql).toContain("lifecycle_state");
      expect(childUpdates[0]?.sql).toContain("active");
      expect(childUpdates[0]?.sql).toContain("deletion_job_id");
      expect(childUpdates[0]?.sql).toContain("deleting_at");
      expect(childUpdates[1]?.sql).toContain("deletion_job_id");
      expect(childUpdates[1]?.sql).toContain("IS NULL");
      const logicalDocumentUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "logical_documents",
      );
      expect(logicalDocumentUpdate?.sql).toContain(
        dialect === "postgres" ? `"provider_item_digest" = NULL` : "`provider_item_digest` = NULL",
      );
      const childResidue = calls.find(
        (call) => call.operation === "select" && call.tableName === "document_assets",
      );
      expect(childResidue?.sql).toContain("source_id");
    });

    it(`deletes Research history only for the whole knowledge space (${dialect})`, async () => {
      const partialId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12";
      for (const deletionJob of [
        job(),
        job({ targetId: "source-a", targetType: "source" }),
        job({ targetId: "logical-document-a", targetType: "logical_document" }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "research_task_partial_results") {
            return result([{ id: partialId }]);
          }
          return result([]);
        };

        await expect(
          capabilitiesFor(dialect, execute).deleteDerivedDataPage({
            job: deletionJob,
            limit: 10,
            signal: new AbortController().signal,
          }),
        ).resolves.toEqual({ complete: true, deleted: 0 });
        expect(calls.some((call) => call.tableName.startsWith("research_task_"))).toBe(false);
      }

      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "research_task_partial_results") {
          return result([{ id: partialId }]);
        }
        return result([]);
      };
      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: job({ targetId: spaceId, targetType: "knowledge_space" }),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });
      const partialSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "research_task_partial_results",
      );
      expect(partialSelect?.sql).toContain("tenant_id");
      expect(partialSelect?.sql).toContain("knowledge_space_id");
      expect(
        calls.find(
          (call) =>
            call.operation === "delete" && call.tableName === "research_task_partial_results",
        )?.params,
      ).toEqual(["tenant-a", spaceId, partialId]);
    });

    it(`deletes a whole Golden Question row for every target evidence JSON shape (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const goldenId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "golden_questions") {
          return result([{ id: goldenId }]);
        }
        return result([]);
      };

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: job(),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      const select = calls.find(
        (call) => call.operation === "select" && call.tableName === "golden_questions",
      );
      expect(select?.sql).toContain("expected_evidence_ids");
      expect(select?.sql).toContain("evidenceContext");
      expect(select?.sql).toContain("evidenceMatch");
      expect(select?.sql).toContain("missingEvidence");
      expect(select?.sql).toContain("answer_traces");
      expect(select?.sql).toContain("knowledge_nodes");
      expect(select?.sql).toContain(dialect === "postgres" ? "jsonb_array_elements" : "JSON_TABLE");
      if (dialect === "tidb" && select) {
        expect((select.sql.match(/\?/g) ?? []).length).toBe(select.params.length);
      }
      expect(
        calls.find((call) => call.operation === "delete" && call.tableName === "golden_questions")
          ?.params,
      ).toEqual([goldenId]);
    });

    it(`uses a dedicated KnowledgeFS target predicate and bounded terminal cleanup (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const leaseId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d14";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_fs_leases" &&
          input.sql.includes("target_lease") &&
          input.sql.includes("status")
        ) {
          return result([{ id: leaseId }]);
        }
        return result([]);
      };

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: job(),
          limit: 4,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      const select = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "knowledge_fs_leases" &&
          call.sql.includes("target_lease"),
      );
      expect(select?.params).toContain("tenant-a");
      expect(select?.params).toContain(spaceId);
      expect(select?.params).toContain(targetDocumentId);
      expect(select?.params.at(-1)).toBe(4);
      expect(select?.sql).toContain("target_type");
      expect(select?.sql).toContain("target_id");
      expect(select?.sql).toContain("virtual_path");
      expect(select?.sql).toContain("parse_artifacts");
      expect(select?.sql).toContain("index_projections");
      expect(select?.sql).toContain("knowledge_paths");
      expect(select?.sql).toContain("knowledge_space_staged_commits");
      expect(select?.sql).not.toContain('target_lease."document_asset_id"');
      expect(select?.sql).not.toContain("target_lease.`document_asset_id`");
      if (dialect === "postgres") {
        expect(select?.params).toEqual(["tenant-a", spaceId, targetDocumentId, 4]);
        expect(select?.sql).toContain('target_lease."target_id" = CAST(CAST($2 AS UUID) AS TEXT)');
        expect(select?.sql).toContain('target_lease."target_id" = CAST(CAST($3 AS UUID) AS TEXT)');
        expect(select?.sql).toContain(
          "semantic_document_ref.document_asset_id = CAST(CAST($3 AS UUID) AS TEXT)",
        );
      } else if (select) {
        expect((select.sql.match(/\?/g) ?? []).length).toBe(select.params.length);
      }
      expect(
        calls.find(
          (call) => call.operation === "delete" && call.tableName === "knowledge_fs_leases",
        )?.params,
      ).toEqual([leaseId]);
    });

    it(`deletes target projections before their knowledge nodes (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "knowledge_nodes") {
          return result([{ id: targetNodeId }]);
        }
        if (input.operation === "select" && input.tableName === "index_projections") {
          return result([{ id: targetProjectionId }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job(),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      const projectionSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "index_projections",
      );
      expect(projectionSelect?.params).toContain(targetNodeId);
      expect(projectionSelect?.sql).toContain("node_id");
      expect(
        calls.find((call) => call.operation === "delete" && call.tableName === "index_projections")
          ?.params,
      ).toEqual([targetProjectionId]);
      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "knowledge_nodes"),
      ).toBe(false);
    });

    it(`removes every non-FK document-derived residue page with exact scoping (${dialect})`, async () => {
      const rowsByTable = new Map<string, readonly Record<string, unknown>[]>([
        [
          "page_index_upgrade_backfill_items",
          [
            {
              backfill_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d20",
              document_outline_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
            },
          ],
        ],
        [
          "legacy_space_publication_bootstrap_items",
          [
            {
              bootstrap_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d22",
              document_asset_id: targetDocumentId,
            },
          ],
        ],
        ["page_index_manifests", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d23" }]],
        ["document_outlines", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d24" }]],
        ["document_multimodal_manifests", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d25" }]],
        ["knowledge_paths", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d26" }]],
        ["knowledge_space_staged_commits", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d27" }]],
        ["parse_artifacts", [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d28" }]],
      ]);
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && rowsByTable.has(input.tableName)) {
          return result(rowsByTable.get(input.tableName) ?? []);
        }
        if (input.operation === "delete" && rowsByTable.has(input.tableName)) {
          rowsByTable.set(input.tableName, []);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);

      for (let page = 0; page < 8; page += 1) {
        await expect(
          capabilities.deleteDerivedDataPage({
            job: job(),
            limit: 10,
            signal: new AbortController().signal,
          }),
        ).resolves.toMatchObject({ complete: false, deleted: 1 });
      }

      expect([...rowsByTable.values()].every((rows) => rows.length === 0)).toBe(true);
      const deletedTables = calls
        .filter((call) => call.operation === "delete")
        .map((call) => call.tableName);
      expect(deletedTables).toEqual([
        "knowledge_paths",
        "page_index_upgrade_backfill_items",
        "legacy_space_publication_bootstrap_items",
        "page_index_manifests",
        "document_outlines",
        "document_multimodal_manifests",
        "knowledge_space_staged_commits",
        "parse_artifacts",
      ]);
      const pathSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "knowledge_paths",
      );
      expect(pathSelect?.sql).toContain("resource_type");
      expect(pathSelect?.sql).toContain("document");
      expect(pathSelect?.sql).toContain("documentAssetIds");
      expect(pathSelect?.sql).toContain("sourceSummaryNodeIds");
      expect(pathSelect?.sql).toContain("communityId");
      const parseArtifactSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "parse_artifacts",
      );
      expect(parseArtifactSelect?.sql).toContain("document_assets");
      expect(parseArtifactSelect?.sql).toContain("knowledge_space_id");
    });

    it(`scopes the final parse-artifact residue probe to the target knowledge space (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        return result([]);
      };
      const targetJob = job();

      await expect(
        capabilitiesFor(dialect, execute).deletePrimaryData({
          job: targetJob,
          leaseFence: {
            deletionJobId: targetJob.id,
            expectedRowVersion: targetJob.rowVersion,
            leaseToken: targetJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });

      const parseArtifactProbe = calls.find(
        (call) => call.operation === "select" && call.tableName === "parse_artifacts",
      );
      expect(parseArtifactProbe?.sql).toContain("document_assets");
      expect(parseArtifactProbe?.sql).toContain("knowledge_space_id");
    });

    it(`fails the space primary proof when any cascaded derived row survives (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "graph_entities") {
          return result([{ residue: 1 }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });

      await expect(
        capabilities.deletePrimaryData({
          job: spaceJob,
          leaseFence: {
            deletionJobId: spaceJob.id,
            expectedRowVersion: spaceJob.rowVersion,
            leaseToken: spaceJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: false });

      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "knowledge_spaces"),
      ).toBe(false);
      const graphProbe = calls.find(
        (call) => call.operation === "select" && call.tableName === "graph_entities",
      );
      expect(graphProbe?.sql).toContain("knowledge_space_id");
      expect(graphProbe?.params).toEqual([spaceId]);
    });

    it(`reconciles a late document object before any primary row is deleted (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const rawObjectKey = `${prefix}/documents/${targetDocumentId}/raw.md`;
      const objectStorage = createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1_024,
      });
      await objectStorage.putObject({ body: new Uint8Array([1]), key: rawObjectKey });
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: prefix }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "document_assets" &&
          input.sql.includes("object_key")
        ) {
          return result([{ id: targetDocumentId, object_key: rawObjectKey }]);
        }
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const documentJob = job();

      await expect(
        capabilities.deletePrimaryData({
          job: documentJob,
          leaseFence: {
            deletionJobId: documentJob.id,
            expectedRowVersion: documentJob.rowVersion,
            leaseToken: documentJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: false });
      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "document_assets"),
      ).toBe(false);
    });

    it(`deletes the whole-space primary hierarchy child-first after a clean final prefix proof (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const calls: DatabaseExecuteInput[] = [];
      let manifestDeleted = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_manifests" &&
          input.sql.includes("object_key_prefix") &&
          !manifestDeleted
        ) {
          return result([{ object_key_prefix: prefix }]);
        }
        if (input.operation === "delete" && input.tableName === "knowledge_space_manifests") {
          manifestDeleted = true;
        }
        return result([]);
      };
      const objectStorage = createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1_024,
      });
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });

      await expect(
        capabilities.deletePrimaryData({
          job: spaceJob,
          leaseFence: {
            deletionJobId: spaceJob.id,
            expectedRowVersion: spaceJob.rowVersion,
            leaseToken: spaceJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });

      expect(
        calls
          .filter((call) => call.operation === "delete")
          .map((call) => call.tableName)
          .slice(0, 18),
      ).toEqual([
        "document_reindex_attempts",
        "document_chunk_state_changes",
        "document_revision_chunks",
        "document_settings_heads",
        "document_settings_revisions",
        "document_revisions",
        "logical_documents",
        "document_assets",
        "sources",
        "source_oauth_transactions",
        "source_connections",
        "knowledge_space_profile_migration_runs",
        "knowledge_space_profile_backfills",
        "knowledge_space_profile_publication_bindings",
        "knowledge_space_profile_heads",
        "knowledge_space_profile_revisions",
        "knowledge_space_manifests",
        "knowledge_spaces",
      ]);
    });

    it(`quiesces Source product workflows and connection secret cleanup before deletion (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          (input.tableName === "source_workflow_runs" ||
            input.tableName === "source_connection_secret_refs")
        ) {
          return result([{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01" }]);
        }
        return result([]);
      };
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });
      await expect(
        capabilitiesFor(dialect, execute).quiesce({
          job: spaceJob,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ drained: false });

      const updates = calls
        .filter((call) => call.operation === "update")
        .map((call) => call.tableName);
      expect(updates).toEqual(
        expect.arrayContaining([
          "source_workflow_runs",
          "source_workflow_outbox",
          "source_oauth_transactions",
          "source_connection_secret_refs",
          "source_connections",
        ]),
      );
      const workflowCancel = calls.find(
        (call) => call.operation === "update" && call.tableName === "source_workflow_runs",
      );
      expect(workflowCancel?.sql).toContain("lease_expires_at");
      expect(workflowCancel?.sql).toContain("canceled_at");
      const secretRetirement = calls.find(
        (call) => call.operation === "update" && call.tableName === "source_connection_secret_refs",
      );
      expect(secretRetirement?.sql).toContain("remote_revoke_required");
      expect(secretRetirement?.sql).toContain("recover_after");
    });

    it(`retains the bulk-remove observer while deleting its Source (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: sourceJob.id }]);
        }
        return result([]);
      };
      const sourceJob = job({ targetType: "source" });
      const capabilities = capabilitiesFor(dialect, execute);

      await capabilities.quiesce({
        job: sourceJob,
        signal: new AbortController().signal,
      });
      const workflowCancel = calls.find(
        (call) => call.operation === "update" && call.tableName === "source_workflow_runs",
      );
      expect(workflowCancel?.sql).toContain("source_bulk_workflow_items");
      expect(workflowCancel?.sql).toMatch(/action[`"]?\s*<>\s*'remove'/u);

      calls.length = 0;
      await capabilities.deletePrimaryData({
        job: sourceJob,
        leaseFence: {
          deletionJobId: sourceJob.id,
          expectedRowVersion: sourceJob.rowVersion,
          leaseToken: sourceJob.leaseToken as string,
        },
        signal: new AbortController().signal,
        transaction: { execute },
      });
      const bulkResidueProbe = calls.find(
        (call) => call.operation === "select" && call.tableName === "source_bulk_workflow_items",
      );
      expect(bulkResidueProbe?.sql).toMatch(/action[`"]?\s*<>\s*'remove'/u);
    });

    it(`deletes every Source product workflow child and secret ledger in bounded order (${dialect})`, async () => {
      const order = [
        "source_workflow_outbox",
        "source_crawl_preview_pages",
        "source_bulk_workflow_items",
        "source_workflow_runs",
        "source_sync_policies",
        "source_oauth_transactions",
        "source_connection_secret_refs",
      ];
      const remaining = [...order];
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === remaining[0]) {
          return result([
            {
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
              run_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
            },
          ]);
        }
        if (input.operation === "delete" && input.tableName === remaining[0]) {
          remaining.shift();
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });
      for (const _table of order) {
        await expect(
          capabilities.deleteDerivedDataPage({
            job: spaceJob,
            limit: 1,
            signal: new AbortController().signal,
          }),
        ).resolves.toEqual({ complete: false, deleted: 1 });
      }
      expect(remaining).toEqual([]);
      expect(
        calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
      ).toEqual(order);
      for (const table of order) {
        expect(calls.some((call) => call.operation === "select" && call.tableName === table)).toBe(
          true,
        );
      }
    });

    it(`blocks source primary deletion when Source product residue survives (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_sync_policies") {
          return result([{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e04" }]);
        }
        return result([]);
      };
      const sourceJob = job({ targetType: "source" });
      await expect(
        capabilitiesFor(dialect, execute).deletePrimaryData({
          job: sourceJob,
          leaseFence: {
            deletionJobId: sourceJob.id,
            expectedRowVersion: sourceJob.rowVersion,
            leaseToken: sourceJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: false });
      expect(calls.some((call) => call.tableName === "source_sync_policies")).toBe(true);
      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "sources"),
      ).toBe(false);
    });

    it(`explicitly removes whole-space knowledge paths when FK cascades are unavailable (${dialect})`, async () => {
      const pathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d33";
      let pathPresent = true;
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (pathPresent && input.operation === "select" && input.tableName === "knowledge_paths") {
          return result([{ id: pathId }]);
        }
        if (input.operation === "delete" && input.tableName === "knowledge_paths") {
          pathPresent = false;
        }
        return result([]);
      };
      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: spaceJob,
          limit: 5,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });
      expect(
        calls.find((call) => call.operation === "delete" && call.tableName === "knowledge_paths")
          ?.params,
      ).toEqual([pathId]);
    });

    it(`rolls back a derived page when its lease expires during an external-return path (${dialect})`, async () => {
      let fenceChecks = 0;
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          fenceChecks += 1;
          return fenceChecks === 1 ? result([{ id: job().id }]) : result([]);
        }
        if (input.operation === "select" && input.tableName === "resource_mounts") {
          return result([{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d34" }]);
        }
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1_024 }),
        secretStore: { delete: vi.fn(async () => undefined) },
      });

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job({ targetId: spaceId, targetType: "knowledge_space" }),
          limit: 5,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("lease fence lost");
      expect(fenceChecks).toBe(2);
      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "resource_mounts"),
      ).toBe(true);
    });

    it(`waits for live worker leases but drains crashed expired leases without a runtime (${dialect})`, async () => {
      const workerTables = new Set([
        "document_compilation_attempts",
        "research_task_jobs",
        "legacy_space_publication_bootstraps",
        "page_index_upgrade_backfills",
        "tidb_fts_posting_backfills",
        "source_credential_backfills",
      ]);
      const run = async (lease: "expired" | "live") => {
        const active = new Set([...workerTables, "knowledge_space_mutation_leases"]);
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (
            lease === "expired" &&
            input.operation === "update" &&
            workerTables.has(input.tableName)
          ) {
            active.delete(input.tableName);
          }
          if (
            lease === "expired" &&
            input.operation === "delete" &&
            input.tableName === "knowledge_space_mutation_leases"
          ) {
            active.delete(input.tableName);
          }
          if (input.operation === "select" && active.has(input.tableName)) {
            return result([{ id: `${input.tableName}-active` }]);
          }
          return result([]);
        };

        const quiescence = await capabilitiesFor(dialect, execute).quiesce({
          job: job({ targetId: spaceId, targetType: "knowledge_space" }),
          signal: new AbortController().signal,
        });
        return { calls, quiescence };
      };

      const live = await run("live");
      expect(live.quiescence).toEqual({ drained: false });
      const expired = await run("expired");
      expect(expired.quiescence).toEqual({ drained: true });

      for (const table of workerTables) {
        const cancellation = expired.calls.find(
          (call) => call.operation === "update" && call.tableName === table,
        );
        expect(cancellation?.sql, table).toContain("lease_expires_at");
        expect(cancellation?.sql, table).toContain(
          table === "research_task_jobs" ? "lease_token" : "running",
        );
        const liveProbe = live.calls.find(
          (call) => call.operation === "select" && call.tableName === table,
        );
        expect(liveProbe?.sql, table).toContain("lease_expires_at");
        expect(liveProbe?.sql, table).toMatch(/>|CURRENT_TIMESTAMP/u);
      }
      const mutationCleanup = expired.calls.find(
        (call) =>
          call.operation === "delete" && call.tableName === "knowledge_space_mutation_leases",
      );
      expect(mutationCleanup?.sql).toContain("expires_at");
      const mutationProbe = live.calls.find(
        (call) =>
          call.operation === "select" && call.tableName === "knowledge_space_mutation_leases",
      );
      expect(mutationProbe?.sql).toContain("expires_at > CURRENT_TIMESTAMP");

      const compilationOutbox = expired.calls.find(
        (call) => call.operation === "update" && call.tableName === "document_compilation_outbox",
      );
      expect(compilationOutbox?.sql).toContain("run_state");
      expect(compilationOutbox?.sql).toContain("canceled");
      const researchOutbox = expired.calls.find(
        (call) => call.operation === "update" && call.tableName === "research_task_outbox",
      );
      expect(researchOutbox?.sql).toContain("stage");
      expect(researchOutbox?.sql).toContain("canceled");
      for (const tableName of [
        "research_task_jobs",
        "research_task_outbox",
        "knowledge_space_staged_commits",
      ]) {
        expect(
          expired.calls.filter(
            (call) => call.operation === "update" && call.tableName === tableName,
          ),
          `${tableName} must be canceled once per quiescing pass`,
        ).toHaveLength(1);
      }
      expect(
        expired.calls.filter(
          (call) =>
            call.operation === "delete" && call.tableName === "knowledge_space_mutation_leases",
        ),
        "mutation leases must be drained once per quiescing pass",
      ).toHaveLength(1);
    });

    it(`drains only retrieval leases acquired before the immutable first-claim fence (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return result([]);
      };
      const firstClaimAt = "2026-07-14T12:00:05.000Z";

      await expect(
        capabilitiesFor(dialect, execute).quiesce({
          job: job({
            checkpoint: "quiescing",
            createdAt: "2026-07-14T12:00:00.000Z",
            startedAt: firstClaimAt,
            targetType: "logical_document",
          }),
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ drained: true });

      const retrievalLeaseReads = calls.filter(
        (call) => call.operation === "select" && call.tableName === "retrieval_execution_leases",
      );
      expect(retrievalLeaseReads).toHaveLength(3);
      for (const read of retrievalLeaseReads) {
        expect(read.params).toContain(firstClaimAt);
        expect(read.params).not.toContain("2026-07-14T12:00:00.000Z");
        expect(read.sql).toContain(dialect === "postgres" ? '"acquired_at"' : "`acquired_at`");
      }
      // Queries admitted after first claim are already protected by target visibility and remain
      // outside this fixed set, so a busy space cannot starve target deletion indefinitely.
    });

    it(`falls back to the immutable request time for a legacy unstarted deletion (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return result([]);
      };
      const createdAt = "2026-07-14T12:00:00.000Z";

      await capabilitiesFor(dialect, execute).quiesce({
        job: job({ checkpoint: "quiescing", createdAt, startedAt: undefined }),
        signal: new AbortController().signal,
      });

      const retrievalLeaseReads = calls.filter(
        (call) => call.operation === "select" && call.tableName === "retrieval_execution_leases",
      );
      expect(retrievalLeaseReads).toHaveLength(3);
      for (const read of retrievalLeaseReads) expect(read.params).toContain(createdAt);
    });

    it(`removes only the logical-document Overview rows and never inventories source secrets (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      let overviewReturned = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_attention_states" &&
          !overviewReturned
        ) {
          overviewReturned = true;
          return result([{ id: targetTraceId }]);
        }
        return result([]);
      };
      const logicalJob = job({ targetType: "logical_document" });

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: logicalJob,
          limit: 7,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      const overview = calls.find(
        (call) =>
          call.operation === "select" && call.tableName === "knowledge_space_attention_states",
      );
      expect(overview?.params).toEqual(
        dialect === "postgres"
          ? [logicalJob.tenantId, logicalJob.knowledgeSpaceId, 7, logicalJob.targetId]
          : [logicalJob.tenantId, logicalJob.knowledgeSpaceId, logicalJob.targetId, 7],
      );
      expect(overview?.sql).toContain("resource_type");
      expect(overview?.sql).toContain("document");
      expect(overview?.sql).toContain("resource_id");
      expect(calls.some((call) => call.tableName === "source_secret_lifecycle_refs")).toBe(false);
      expect(
        calls.some(
          (call) =>
            call.operation === "delete" && call.tableName === "knowledge_space_attention_states",
        ),
      ).toBe(true);
    });

    it(`uses a UUID source predicate while deleting source Overview residue (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return result([]);
      };

      await capabilitiesFor(dialect, execute).deleteDerivedDataPage({
        job: job({ targetType: "source" }),
        limit: 7,
        signal: new AbortController().signal,
      });

      const overviewQueries = calls.filter(
        (call) =>
          call.operation === "select" &&
          (call.tableName === "knowledge_space_attention_states" ||
            call.tableName === "knowledge_space_activity_events") &&
          call.sql.includes("logical_documents"),
      );
      expect(overviewQueries.length).toBeGreaterThan(0);
      for (const query of overviewQueries) {
        const targetPosition = query.params.length === 4 ? 4 : 3;
        expect(query.sql).toContain(
          dialect === "postgres"
            ? `"source_id" = CAST($${targetPosition} AS UUID)`
            : "`source_id` = ?",
        );
      }
    });

    it(`removes only an unpublished aggregate exactly owned by the deleted asset (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const rawObjectKey = `${prefix}/documents/${targetDocumentId}/raw.md`;
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_manifests" &&
          input.sql.includes("object_key_prefix")
        ) {
          return result([{ object_key_prefix: prefix }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "document_assets" &&
          input.sql.includes("object_key")
        ) {
          return result([{ id: targetDocumentId, object_key: rawObjectKey }]);
        }
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1_024 }),
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const documentJob = job();

      await expect(
        capabilities.deletePrimaryData({
          job: documentJob,
          leaseFence: {
            deletionJobId: documentJob.id,
            expectedRowVersion: documentJob.rowVersion,
            leaseToken: documentJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });

      const aggregateDelete = calls.find(
        (call) => call.operation === "delete" && call.tableName === "logical_documents",
      );
      expect(aggregateDelete?.params).toEqual(
        dialect === "postgres"
          ? [documentJob.tenantId, documentJob.knowledgeSpaceId, documentJob.targetId]
          : [
              documentJob.tenantId,
              documentJob.knowledgeSpaceId,
              documentJob.tenantId,
              documentJob.knowledgeSpaceId,
              documentJob.targetId,
              documentJob.tenantId,
              documentJob.knowledgeSpaceId,
              documentJob.targetId,
            ],
      );
      expect(aggregateDelete?.sql).toContain("target_revision");
      expect(aggregateDelete?.sql).toContain("retained_revision");
      expect(aggregateDelete?.sql).toContain("NOT IN ('candidate', 'failed')");
      expect(aggregateDelete?.sql).toContain("activated_at");
      const aggregateIndex = calls.findIndex((call) => call === aggregateDelete);
      const revisionDeleteIndex = calls.findIndex(
        (call) => call.operation === "delete" && call.tableName === "document_revisions",
      );
      expect(aggregateIndex).toBeLessThan(revisionDeleteIndex);
    });

    it(`deletes a logical aggregate child-first while preserving shared assets outside its job fence (${dialect})`, async () => {
      const prefix = `tenant-a/spaces/${spaceId}`;
      const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99";
      const rawObjectKey = `${prefix}/documents/${assetId}/raw.md`;
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_manifests" &&
          input.sql.includes("object_key_prefix")
        ) {
          return result([{ object_key_prefix: prefix }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "document_assets" &&
          input.sql.includes("object_key")
        ) {
          return result([{ id: assetId, object_key: rawObjectKey }]);
        }
        return result([]);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const capabilities = createDatabaseDurableDeletionTargetCapabilities({
        cache: createMemoryCacheAdapter({ maxEntries: 10 }),
        database,
        objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1_024 }),
        secretStore: { delete: vi.fn(async () => undefined) },
      });
      const logicalJob = job({ targetType: "logical_document" });

      await expect(
        capabilities.deletePrimaryData({
          job: logicalJob,
          leaseFence: {
            deletionJobId: logicalJob.id,
            expectedRowVersion: logicalJob.rowVersion,
            leaseToken: logicalJob.leaseToken as string,
          },
          signal: new AbortController().signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });

      const finalObjectProbe = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "document_assets" &&
          call.sql.includes("object_key"),
      );
      expect(finalObjectProbe?.sql).toContain("deletion_job_id");
      expect(finalObjectProbe?.params).toContain(logicalJob.id);
      const derivedProbe = calls.find(
        (call) => call.operation === "select" && call.tableName === "knowledge_nodes",
      );
      expect(derivedProbe?.sql).toContain("document_revisions");
      expect(derivedProbe?.sql).toContain("external_revision");
      expect(derivedProbe?.sql).toContain("NOT EXISTS");

      const primaryDeletes = calls
        .filter((call) => call.operation === "delete")
        .map((call) => call.tableName);
      expect(primaryDeletes.slice(-8)).toEqual([
        "document_reindex_attempts",
        "document_chunk_state_changes",
        "document_revision_chunks",
        "document_settings_heads",
        "document_settings_revisions",
        "document_revisions",
        "logical_documents",
        "document_assets",
      ]);
      const assetDelete = calls.find(
        (call) => call.operation === "delete" && call.tableName === "document_assets",
      );
      expect(assetDelete?.sql).toContain("deletion_job_id");
      expect(assetDelete?.params).toEqual([logicalJob.knowledgeSpaceId, logicalJob.id]);
      expect(
        calls.some((call) => call.operation === "delete" && call.tableName === "sources"),
      ).toBe(false);
    });
  }
});

describe("database durable deletion target capability edge branches", () => {
  const signal = new AbortController().signal;

  it("requires bounded cache prefix deletion and rejects an already-aborted operation", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 10 });
    const { deletePrefix: _deletePrefix, ...cacheWithoutPrefixDelete } = cache;
    const database = createSchemaDatabaseAdapter({
      executor: async () => result([]),
      kind: "postgres",
    });
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1_024,
    });

    expect(() =>
      createDatabaseDurableDeletionTargetCapabilities({
        cache: cacheWithoutPrefixDelete,
        database,
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      }),
    ).toThrow("cache.deletePrefix");

    const controller = new AbortController();
    controller.abort(new Error("stop deletion"));
    await expect(
      createDatabaseDurableDeletionTargetCapabilities({
        cache,
        database,
        objectStorage,
        secretStore: { delete: vi.fn(async () => undefined) },
      }).inventory({
        job: job(),
        limit: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop deletion");
  });

  it("paginates every inventory source and transitions source and logical-document scans", async () => {
    const prefix = `tenant-a/spaces/${spaceId}`;
    const artifactKey = `${prefix}/documents/${targetDocumentId}/artifact.json`;
    const storageKey = `${prefix}/documents/${targetDocumentId}/storage.bin`;
    const lifecycleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
    const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02";
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      if (input.tableName === "knowledge_space_manifests") {
        return result([{ object_key_prefix: prefix }]);
      }
      if (input.operation === "select" && input.tableName === "artifact_segments") {
        return result([{ object_key: artifactKey }]);
      }
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return result([
          { credential_ref: "secret:lifecycle-page", id: lifecycleId, source_id: sourceId },
        ]);
      }
      if (input.operation === "select" && input.tableName === "sources") {
        return result([{ credential_ref: "secret:source-page", id: sourceId }]);
      }
      return result([]);
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute }),
    });
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1_024,
    });
    await objectStorage.putObject({ body: new Uint8Array([1]), key: storageKey });
    const capabilities = createDatabaseDurableDeletionTargetCapabilities({
      cache: createMemoryCacheAdapter({ maxEntries: 10 }),
      database,
      objectStorage,
      secretStore: { delete: vi.fn(async () => undefined) },
    });
    const cursor = (value: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

    await expect(
      capabilities.inventory({
        cursor: cursor({
          activeDocumentId: targetDocumentId,
          documentScan: "artifacts",
          ordinal: 1,
          phase: "document_objects",
        }),
        job: job(),
        limit: 1,
        signal,
      }),
    ).resolves.toMatchObject({
      complete: false,
      items: [expect.objectContaining({ objectKey: artifactKey })],
    });

    await expect(
      capabilities.inventory({
        cursor: cursor({
          activeDocumentId: targetDocumentId,
          documentScan: "storage",
          ordinal: 1,
          phase: "document_objects",
        }),
        job: job(),
        limit: 1,
        signal,
      }),
    ).resolves.toMatchObject({
      complete: false,
      items: [expect.objectContaining({ objectKey: storageKey })],
    });

    await expect(
      capabilities.inventory({
        cursor: cursor({ ordinal: 1, phase: "lifecycle_secrets" }),
        job: job({ targetId: spaceId, targetType: "knowledge_space" }),
        limit: 1,
        signal,
      }),
    ).resolves.toMatchObject({ complete: false, scanPhase: "lifecycle_secrets" });
    await expect(
      capabilities.inventory({
        cursor: cursor({ ordinal: 1, phase: "source_secrets" }),
        job: job({ targetId: spaceId, targetType: "knowledge_space" }),
        limit: 1,
        signal,
      }),
    ).resolves.toMatchObject({ complete: false, scanPhase: "source_secrets" });

    await expect(
      capabilities.inventory({
        job: job({ targetType: "source" }),
        limit: 1,
        signal,
      }),
    ).resolves.toMatchObject({ complete: false, scanPhase: "lifecycle_secrets" });
    await expect(
      capabilities.inventory({
        job: job({ targetType: "logical_document" }),
        limit: 1,
        signal,
      }),
    ).resolves.toEqual({ complete: true, items: [], scanPhase: "document_objects:1" });
  });

  it("fails closed for duplicate, escaping, and non-progressing object pages", async () => {
    const prefix = `tenant-a/spaces/${spaceId}`;
    const duplicateKey = `${prefix}/documents/${targetDocumentId}/duplicate.bin`;
    const cursor = Buffer.from(
      JSON.stringify({
        activeDocumentId: targetDocumentId,
        documentScan: "artifacts",
        ordinal: 1,
        phase: "document_objects",
      }),
      "utf8",
    ).toString("base64url");
    const duplicateCapabilities = capabilitiesFor("postgres", async (input) => {
      if (input.tableName === "knowledge_space_manifests") {
        return result([{ object_key_prefix: prefix }]);
      }
      if (input.tableName === "artifact_segments") {
        return result([{ object_key: duplicateKey }, { object_key: duplicateKey }]);
      }
      return result([]);
    });
    await expect(
      duplicateCapabilities.inventory({ cursor, job: job(), limit: 2, signal }),
    ).rejects.toThrow("unbounded or duplicated");

    await expect(
      duplicateCapabilities.executeExternalItem({
        item: deletionItem("object", { objectKey: "another-space/object.bin" }),
        job: job(),
        signal,
      }),
    ).rejects.toThrow("escapes the immutable space prefix");

    const baseStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1_024,
    });
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> =>
      input.tableName === "knowledge_space_manifests"
        ? result([{ object_key_prefix: prefix }])
        : result([]);
    const database = createSchemaDatabaseAdapter({ executor: execute, kind: "postgres" });
    const invalidStorageCapabilities = createDatabaseDurableDeletionTargetCapabilities({
      cache: createMemoryCacheAdapter({ maxEntries: 10 }),
      database,
      objectStorage: {
        ...baseStorage,
        listObjects: async () => ({ nextCursor: "next", objects: [] }),
      },
      secretStore: { delete: vi.fn(async () => undefined) },
    });
    const storageCursor = Buffer.from(
      JSON.stringify({
        activeDocumentId: targetDocumentId,
        documentScan: "storage",
        ordinal: 1,
        phase: "document_objects",
      }),
      "utf8",
    ).toString("base64url");
    await expect(
      invalidStorageCapabilities.inventory({
        cursor: storageCursor,
        job: job(),
        limit: 1,
        signal,
      }),
    ).rejects.toThrow("did not make bounded progress");
  });

  it.each([
    {
      label: "retrieval lease history",
      mode: "space-table",
      table: "retrieval_execution_leases",
    },
    { label: "failed queries", mode: "table", table: "failed_queries" },
    { label: "quality history", mode: "table", table: "quality_resource_history" },
    { label: "active agent snapshots", mode: "table", table: "agent_workspace_snapshots" },
    { label: "KnowledgeFS lease history", mode: "history-lease", table: "knowledge_fs_leases" },
    {
      label: "historical publications",
      mode: "table",
      table: "projection_set_publications",
    },
    { label: "direct source paths", mode: "source-path", table: "knowledge_paths" },
    { label: "retained source metadata", mode: "metadata", table: "document_assets" },
  ])("returns a bounded derived cleanup page for $label", async ({ mode, table }) => {
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      if (input.operation !== "select" || input.tableName !== table) return result([]);
      if (mode === "history-lease" && input.sql.includes("target_lease")) return result([]);
      if (mode === "source-path" && !input.sql.includes("resource_type")) return result([]);
      if (mode === "metadata" && !input.sql.includes("metadata")) return result([]);
      return result([{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f10" }]);
    };
    const targetJob =
      mode === "source-path"
        ? job({ targetType: "source" })
        : mode === "metadata"
          ? job({ deleteMode: "keep", targetType: "source" })
          : mode === "space-table" ||
              mode === "history-lease" ||
              table === "failed_queries" ||
              table === "agent_workspace_snapshots"
            ? job({ targetId: spaceId, targetType: "knowledge_space" })
            : job();

    await expect(
      capabilitiesFor("postgres", execute).deleteDerivedDataPage({
        job: targetJob,
        limit: 1,
        signal,
      }),
    ).resolves.toEqual({ complete: false, deleted: 1 });
  });

  it.each([
    "resource_mounts",
    "failed_queries",
    "agent_workspace_snapshots",
    "quality_resource_history",
    "knowledge_fs_leases",
    "golden_questions",
    "knowledge_space_activity_events",
    "knowledge_paths",
    "knowledge_nodes",
    "page_index_upgrade_backfill_items",
  ])("fails the final derived residue proof at %s", async (residueTable) => {
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> =>
      input.operation === "select" && input.tableName === residueTable
        ? result([{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f20" }])
        : result([]);
    const targetJob = [
      "resource_mounts",
      "failed_queries",
      "agent_workspace_snapshots",
      "knowledge_fs_leases",
    ].includes(residueTable)
      ? job({ targetId: spaceId, targetType: "knowledge_space" })
      : job();

    await expect(
      capabilitiesFor("postgres", execute).deletePrimaryData({
        job: targetJob,
        leaseFence: {
          deletionJobId: targetJob.id,
          expectedRowVersion: targetJob.rowVersion,
          leaseToken: targetJob.leaseToken as string,
        },
        signal,
        transaction: { execute },
      }),
    ).resolves.toEqual({ clean: false });
  });

  it.each(["postgres", "tidb"] as const)(
    "treats Research residue as forbidden only for knowledge-space deletion (%s)",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        return input.operation === "select" && input.tableName === "research_task_jobs"
          ? result([{ id: "retained-research-history" }])
          : result([]);
      };
      for (const childJob of [
        job(),
        job({ targetId: "source-a", targetType: "source" }),
        job({ targetId: "logical-document-a", targetType: "logical_document" }),
      ]) {
        await expect(
          capabilitiesFor(dialect, execute).deletePrimaryData({
            job: childJob,
            leaseFence: {
              deletionJobId: childJob.id,
              expectedRowVersion: childJob.rowVersion,
              leaseToken: childJob.leaseToken as string,
            },
            signal,
            transaction: { execute },
          }),
        ).resolves.toEqual({ clean: true });
        expect(calls.some((call) => call.tableName.startsWith("research_task_"))).toBe(false);
        calls.length = 0;
      }

      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });
      await expect(
        capabilitiesFor(dialect, execute).deletePrimaryData({
          job: spaceJob,
          leaseFence: {
            deletionJobId: spaceJob.id,
            expectedRowVersion: spaceJob.rowVersion,
            leaseToken: spaceJob.leaseToken as string,
          },
          signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: false });
      expect(calls.some((call) => call.tableName === "research_task_jobs")).toBe(true);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "treats retrieval lease history as residue only for knowledge-space deletion (%s)",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: job().id }]);
        }
        if (input.operation === "select" && input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        return input.operation === "select" && input.tableName === "retrieval_execution_leases"
          ? result([{ id: "retained-retrieval-lease-history" }])
          : result([]);
      };
      for (const childJob of [
        job(),
        job({ targetId: "source-a", targetType: "source" }),
        job({ targetId: "logical-document-a", targetType: "logical_document" }),
      ]) {
        await expect(
          capabilitiesFor(dialect, execute).deletePrimaryData({
            job: childJob,
            leaseFence: {
              deletionJobId: childJob.id,
              expectedRowVersion: childJob.rowVersion,
              leaseToken: childJob.leaseToken as string,
            },
            signal,
            transaction: { execute },
          }),
        ).resolves.toEqual({ clean: true });
        expect(calls.some((call) => call.tableName === "retrieval_execution_leases")).toBe(false);
        calls.length = 0;
      }

      const spaceJob = job({ targetId: spaceId, targetType: "knowledge_space" });
      await expect(
        capabilitiesFor(dialect, execute).deletePrimaryData({
          job: spaceJob,
          leaseFence: {
            deletionJobId: spaceJob.id,
            expectedRowVersion: spaceJob.rowVersion,
            leaseToken: spaceJob.leaseToken as string,
          },
          signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: false });
      expect(calls.some((call) => call.tableName === "retrieval_execution_leases")).toBe(true);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "tombstones only child-target quality evidence and keeps replay history (%s)",
    async (dialect) => {
      const childJob = job();
      const itemId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f30";
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          input.tableName === "quality_replay_items" &&
          input.sql.includes("target_replay_item")
        ) {
          return result([{ id: itemId }]);
        }
        return result([]);
      };

      await expect(
        capabilitiesFor(dialect, execute).deleteDerivedDataPage({
          job: childJob,
          limit: 7,
          signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      expect(calls.some((call) => call.tableName === "quality_replay_runs")).toBe(false);
      expect(calls.some((call) => call.tableName === "quality_replay_outbox")).toBe(false);
      const tombstone = calls.find(
        (call) => call.operation === "update" && call.tableName === "quality_replay_items",
      );
      expect(tombstone?.params).toEqual([itemId]);
      expect(tombstone?.sql).toContain("'canceled'");
      expect(tombstone?.sql).toContain("result");
      expect(tombstone?.sql).toContain("trace_id");
      expect(tombstone?.sql).toContain("expected_evidence_ids");
      for (const call of calls.filter(
        (candidate) =>
          candidate.operation === "select" && candidate.tableName.startsWith("quality_"),
      )) {
        expect(call.params).toContain(childJob.targetId);
        if (dialect === "tidb") {
          expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
        }
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "does not treat unrelated child quality history as deletion residue (%s)",
    async (dialect) => {
      const childJob = job();
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: childJob.id }]);
        }
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        if (
          input.operation === "select" &&
          ["quality_replay_runs", "quality_replay_outbox"].includes(input.tableName)
        ) {
          return result([{ id: "unrelated-quality-history" }]);
        }
        return result([]);
      };

      await expect(
        capabilitiesFor(dialect, execute).deletePrimaryData({
          job: childJob,
          leaseFence: {
            deletionJobId: childJob.id,
            expectedRowVersion: childJob.rowVersion,
            leaseToken: childJob.leaseToken as string,
          },
          signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });
      expect(calls.some((call) => call.tableName === "quality_replay_runs")).toBe(false);
      expect(calls.some((call) => call.tableName === "quality_replay_outbox")).toBe(false);
      if (dialect === "tidb") {
        for (const call of calls.filter(
          (candidate) =>
            candidate.operation === "select" && candidate.tableName.startsWith("quality_"),
        )) {
          expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
        }
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps space-wide product history out of child-target cleanup and residue proof (%s)",
    async (dialect) => {
      const childJob = job({
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
        targetType: "source",
      });
      const cleanupCalls: DatabaseExecuteInput[] = [];
      await expect(
        capabilitiesFor(dialect, async (input) => {
          cleanupCalls.push(input);
          return result([]);
        }).deleteDerivedDataPage({
          job: childJob,
          limit: 7,
          signal,
        }),
      ).resolves.toEqual({ complete: true, deleted: 0 });

      for (const retainedTable of [
        "resource_mounts",
        "failed_queries",
        "agent_workspace_snapshots",
        "knowledge_fs_sessions",
      ]) {
        expect(
          cleanupCalls.some((call) => call.tableName === retainedTable),
          `${retainedTable} is space history and must survive child deletion`,
        ).toBe(false);
      }
      const targetLeaseRead = cleanupCalls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "knowledge_fs_leases" &&
          call.sql.includes("target_lease"),
      );
      expect(targetLeaseRead?.params).toContain(childJob.targetId);
      if (dialect === "tidb" && targetLeaseRead) {
        expect(targetLeaseRead.sql.match(/\?/gu) ?? []).toHaveLength(targetLeaseRead.params.length);
      }

      const proofCalls: DatabaseExecuteInput[] = [];
      const executeProof = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        proofCalls.push(input);
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: childJob.id }]);
        }
        if (
          input.operation === "select" &&
          [
            "resource_mounts",
            "failed_queries",
            "agent_workspace_snapshots",
            "knowledge_fs_sessions",
          ].includes(input.tableName)
        ) {
          return result([{ id: "retained-space-history" }]);
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_fs_leases" &&
          !input.sql.includes("target_lease")
        ) {
          return result([{ id: "unrelated-document-lease" }]);
        }
        return result([]);
      };
      await expect(
        capabilitiesFor(dialect, executeProof).deletePrimaryData({
          job: childJob,
          leaseFence: {
            deletionJobId: childJob.id,
            expectedRowVersion: childJob.rowVersion,
            leaseToken: childJob.leaseToken as string,
          },
          signal,
          transaction: { execute: executeProof },
        }),
      ).resolves.toEqual({ clean: true });
      expect(proofCalls.some((call) => call.tableName === "knowledge_fs_sessions")).toBe(false);
      const targetLeaseProof = proofCalls.find(
        (call) => call.tableName === "knowledge_fs_leases" && call.sql.includes("target_lease"),
      );
      if (dialect === "tidb" && targetLeaseProof) {
        expect(targetLeaseProof.sql.match(/\?/gu) ?? []).toHaveLength(
          targetLeaseProof.params.length,
        );
      }
      expect(
        proofCalls.some(
          (call) =>
            call.operation === "select" &&
            call.tableName === "knowledge_fs_leases" &&
            !call.sql.includes("target_lease"),
        ),
      ).toBe(false);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps unrelated leases scoped but waits for pre-fence whole-space backfills (%s)",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_fs_leases" &&
          !input.sql.includes("target_lease")
        ) {
          return result([{ id: "unrelated-live-lease" }]);
        }
        if (
          input.operation === "select" &&
          [
            "knowledge_space_mutation_leases",
            "legacy_space_publication_bootstraps",
            "page_index_upgrade_backfills",
            "tidb_fts_posting_backfills",
          ].includes(input.tableName)
        ) {
          return result([{ id: "unrelated-global-worker" }]);
        }
        return result([]);
      };
      const childJob = job({ targetType: "logical_document" });

      await expect(
        capabilitiesFor(dialect, execute).quiesce({
          job: childJob,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ drained: false });

      expect(
        calls.some(
          (call) =>
            call.operation === "select" &&
            call.tableName === "knowledge_fs_leases" &&
            !call.sql.includes("target_lease"),
        ),
      ).toBe(false);
      const targetLeaseProbe = calls.find(
        (call) => call.tableName === "knowledge_fs_leases" && call.sql.includes("target_lease"),
      );
      if (dialect === "tidb" && targetLeaseProbe) {
        expect(targetLeaseProbe.sql.match(/\?/gu) ?? []).toHaveLength(
          targetLeaseProbe.params.length,
        );
      }
      for (const globalWorker of [
        "legacy_space_publication_bootstraps",
        "page_index_upgrade_backfills",
        "tidb_fts_posting_backfills",
      ]) {
        expect(calls.some((call) => call.tableName === globalWorker)).toBe(true);
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "cancels only staged commits owned by the child deletion target (%s)",
    async (dialect) => {
      for (const childJob of [
        job({ targetId: targetDocumentId, targetType: "document_asset" }),
        job({ targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10", targetType: "source" }),
        job({
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
          targetType: "logical_document",
        }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        await capabilitiesFor(dialect, async (input) => {
          calls.push(input);
          return result([]);
        }).quiesce({ job: childJob, signal: new AbortController().signal });

        const cancellation = calls.find(
          (call) =>
            call.operation === "update" && call.tableName === "knowledge_space_staged_commits",
        );
        expect(cancellation?.params).toContain(childJob.targetId);
        expect(cancellation?.sql).toContain("document_asset_id");
        if (dialect === "tidb" && cancellation) {
          expect((cancellation.sql.match(/\?/g) ?? []).length).toBe(cancellation.params.length);
        }
        if (childJob.targetType === "source") expect(cancellation?.sql).toContain("source_id");
        if (childJob.targetType === "logical_document") {
          expect(cancellation?.sql).toContain("document_revisions");
          expect(cancellation?.sql).toContain("document_id");
        }
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "preserves every golden question when a source is detached with documents kept (%s)",
    async (dialect) => {
      const sourceKeepJob = job({
        deleteMode: "keep",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
        targetType: "source",
      });
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_manifests") {
          return result([{ object_key_prefix: `tenant-a/spaces/${spaceId}` }]);
        }
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return result([{ id: sourceKeepJob.id }]);
        }
        if (input.operation === "select" && input.tableName === "golden_questions") {
          return result([{ id: "unrelated-golden-question" }]);
        }
        return result([]);
      };
      const capabilities = capabilitiesFor(dialect, execute);

      await expect(
        capabilities.deleteDerivedDataPage({ job: sourceKeepJob, limit: 7, signal }),
      ).resolves.toEqual({ complete: true, deleted: 0 });
      await expect(
        capabilities.deletePrimaryData({
          job: sourceKeepJob,
          leaseFence: {
            deletionJobId: sourceKeepJob.id,
            expectedRowVersion: sourceKeepJob.rowVersion,
            leaseToken: sourceKeepJob.leaseToken as string,
          },
          signal,
          transaction: { execute },
        }),
      ).resolves.toEqual({ clean: true });
      expect(calls.some((call) => call.tableName === "golden_questions")).toBe(false);
    },
  );

  it.each([
    { deleted: -1, label: "negative count" },
    { deleted: 2, label: "unbounded count" },
    { deleted: 0, label: "empty cursor", nextCursor: "" },
    { deleted: 0, label: "cursor without progress", nextCursor: "next" },
  ])("rejects an invalid cache cleanup page with $label", async (page) => {
    const cache = {
      ...createMemoryCacheAdapter({ maxEntries: 10 }),
      deletePrefix: vi.fn(async () => page),
    };
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> =>
      input.operation === "select" && input.tableName === "deletion_jobs"
        ? result([{ id: job().id }])
        : result([]);
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute }),
    });
    const targetJob = job({ deleteMode: "keep", targetType: "source" });
    const capabilities = createDatabaseDurableDeletionTargetCapabilities({
      cache,
      database,
      objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1_024 }),
      secretStore: { delete: vi.fn(async () => undefined) },
    });

    await expect(
      capabilities.deleteDerivedDataPage({ job: targetJob, limit: 1, signal }),
    ).rejects.toThrow(/cache cleanup/);
  });
});

function capabilitiesFor(
  dialect: DatabaseAdapter["dialect"],
  execute: DatabaseExecutor["execute"],
  generatePublicationId?: string,
) {
  const fencedExecute: DatabaseExecutor["execute"] = async (input) => {
    if (dialect === "tidb") {
      expect(input.sql.match(/\?/gu) ?? []).toHaveLength(input.params.length);
    }
    if (
      input.operation === "select" &&
      input.tableName === "deletion_jobs" &&
      input.sql.includes("lease_token") &&
      input.sql.includes("FOR UPDATE")
    ) {
      return result([{ id: job().id }]);
    }
    return execute(input);
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) =>
    callback({ execute: fencedExecute });
  const database = createSchemaDatabaseAdapter({
    executor: fencedExecute,
    kind: dialect,
    transaction,
  });
  return createDatabaseDurableDeletionTargetCapabilities({
    cache: createMemoryCacheAdapter({ maxEntries: 10 }),
    database,
    ...(generatePublicationId ? { generatePublicationId: () => generatePublicationId } : {}),
    objectStorage: createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1024 }),
    secretStore: { delete: vi.fn(async () => undefined) },
  });
}

function result(rows: readonly Record<string, unknown>[]): DatabaseExecuteResult {
  return { rows, rowsAffected: 0 };
}

function job(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    accessChannel: "interactive",
    checkpoint: "deleting_derived_data",
    createdAt: "2026-07-14T12:00:00.000Z",
    deleteMode: "cascade",
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    idempotencyKey: "delete-document-a",
    inventoryComplete: true,
    knowledgeSpaceId: spaceId,
    leaseExpiresAt: "2026-07-14T12:05:00.000Z",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d40",
    maxExecutionAttempts: 10,
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41",
    permissionSnapshotRevision: 1,
    requestFingerprint: "a".repeat(64),
    requestedBySubjectId: "user-a",
    rowVersion: 8,
    runState: "running",
    targetId: targetDocumentId,
    targetRevision: 3,
    targetType: "document_asset",
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T12:00:00.000Z",
    workerId: "worker-a",
    ...overrides,
  };
}

function deletionItem(
  kind: DurableDeletionItemKind,
  overrides: Partial<DurableDeletionJobItem> = {},
): DurableDeletionJobItem {
  return {
    attempts: 0,
    createdAt: "2026-07-14T12:00:00.000Z",
    deletionJobId: job().id,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d50",
    idempotencyKey: `item:${kind}`,
    kind,
    maxAttempts: 3,
    ordinal: 1,
    payloadDigest: "a".repeat(64),
    rowVersion: 1,
    status: "pending",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
