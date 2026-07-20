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
import type { DurableDeletionJob } from "./durable-deletion-repository";

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
      expect(memberInserts.every((call) => call.params[1] === oldPublicationId)).toBe(true);
      expect(memberInserts[0]?.sql).toContain("NOT IN ('graph-entity', 'graph-relation')");
      expect(memberInserts[0]?.sql).toContain("document_asset_id");
      const profileBindingInsert = calls.find(
        (call) =>
          call.operation === "insert" &&
          call.tableName === "knowledge_space_profile_publication_bindings",
      );
      expect(profileBindingInsert?.sql).toContain("content-publication");
      expect(profileBindingInsert?.params).toEqual([
        newPublicationId,
        expect.stringMatching(/^projection-set-sha256:/u),
        expect.any(String),
        job().tenantId,
        job().knowledgeSpaceId,
        oldPublicationId,
      ]);

      const entityCopy = memberInserts[1]?.sql ?? "";
      expect(entityCopy).toContain("graph-entity");
      expect(entityCopy).toContain("candidate_graph_entity");
      expect(entityCopy).toContain("visible_projection_member");
      expect(entityCopy).toContain("index_projections");
      expect(entityCopy).toContain("lifecycle_state");
      expect(entityCopy).toContain("active");
      expect(entityCopy).toContain(
        dialect === "postgres" ? "jsonb_array_elements_text" : "JSON_TABLE",
      );

      const relationCopy = memberInserts[2]?.sql ?? "";
      expect(relationCopy).toContain("graph-relation");
      expect(relationCopy).toContain("subject_entity_id");
      expect(relationCopy).toContain("object_entity_id");
      expect(relationCopy).toContain("subject_entity_member");
      expect(relationCopy).toContain("object_entity_member");

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
      expect(invalidProbe?.sql).toContain("NOT (");
      expect(invalidProbe?.sql).toContain("visible_projection_member");
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

    it(`retains unrelated answer traces during document cleanup (${dialect})`, async () => {
      const remainingTraceIds = new Set([targetTraceId, unrelatedTraceId]);
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "answer_traces") {
          expect(input.params).toEqual([spaceId, targetDocumentId, 10]);
          expect(input.sql).toContain("evidence_bundles");
          expect(input.sql).toContain("documentAssetId");
          expect(input.sql).toContain(
            dialect === "postgres" ? "jsonb_array_elements" : "JSON_TABLE",
          );
          return result([{ evidence_bundle_id: targetBundleId, id: targetTraceId }]);
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
      const capabilities = capabilitiesFor(dialect, execute);

      await expect(
        capabilities.deleteDerivedDataPage({
          job: job(),
          limit: 10,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ complete: false, deleted: 1 });

      expect(remainingTraceIds).toEqual(new Set([unrelatedTraceId]));
      expect(
        calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
      ).toEqual(["failed_queries", "answer_trace_steps", "answer_traces", "evidence_bundles"]);
      const traceDelete = calls.find(
        (call) => call.operation === "delete" && call.tableName === "answer_traces",
      );
      expect(traceDelete?.params).toEqual([targetTraceId]);
    });

    it(`deletes inline-only AnswerTrace evidence for document and Source targets (${dialect})`, async () => {
      for (const deletionJob of [
        job(),
        job({
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          targetType: "source",
        }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "answer_traces") {
            return result([{ evidence_bundle_id: null, id: targetTraceId }]);
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
        ).resolves.toEqual({ complete: false, deleted: 1 });

        const traceSelect = calls.find(
          (call) => call.operation === "select" && call.tableName === "answer_traces",
        );
        expect(traceSelect?.sql).toContain("answer_trace_steps");
        expect(traceSelect?.sql).toContain("target_inline_evidence_step");
        expect(traceSelect?.sql).toContain("evidenceBundle");
        expect(traceSelect?.sql).toContain("documentAssetId");
        expect(traceSelect?.sql).toContain("nodeId");
        expect(traceSelect?.sql).toContain("knowledge_nodes");
        expect(traceSelect?.sql).toContain(
          dialect === "postgres" ? "jsonb_array_elements" : "JSON_TABLE",
        );
        if (deletionJob.targetType === "source") {
          expect(traceSelect?.sql).toContain("source_id");
        }
        expect(
          calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
        ).toEqual(["failed_queries", "answer_trace_steps", "answer_traces"]);
      }
    });

    it(`fails the primary residue proof for inline-only AnswerTrace evidence (${dialect})`, async () => {
      for (const deletionJob of [
        job(),
        job({
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          targetType: "source",
        }),
      ]) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "answer_traces") {
            return result([{ id: targetTraceId }]);
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
        ).resolves.toEqual({ clean: false });

        const traceProbe = calls.find(
          (call) => call.operation === "select" && call.tableName === "answer_traces",
        );
        expect(traceProbe?.sql).toContain("answer_trace_steps");
        expect(traceProbe?.sql).toContain("evidenceBundle");
        expect(traceProbe?.sql).toContain("documentAssetId");
        expect(traceProbe?.sql).toContain("knowledge_nodes");
        expect(
          calls.some(
            (call) =>
              call.operation === "delete" &&
              (call.tableName === "document_assets" || call.tableName === "sources"),
          ),
        ).toBe(false);
      }
    });

    it(`uses source-scoped evidence membership and conservatively scrubs opaque source-keep history (${dialect})`, async () => {
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
      const traceSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "answer_traces",
      );
      expect(traceSelect?.params).toEqual([spaceId, sourceId, 7]);
      expect(traceSelect?.sql).toContain("source_id");

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
      ).toBe(true);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "knowledge_fs_sessions",
        ),
      ).toBe(true);
      expect(
        calls.some((call) => call.operation === "select" && call.tableName === "golden_questions"),
      ).toBe(true);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "research_task_jobs",
        ),
      ).toBe(true);
      expect(
        calls.some((call) => call.operation === "select" && call.tableName === "resource_mounts"),
      ).toBe(true);
      const sourcePath = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "knowledge_paths" &&
          call.sql.includes("resource_type") &&
          call.sql.includes("source"),
      );
      expect(sourcePath?.params).toEqual([spaceId, sourceId, 7]);
      const retainedMetadata = calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "document_assets" &&
          call.sql.includes("sourceId"),
      );
      expect(retainedMetadata?.sql).toContain("credentialRef");
      expect(calls.some((call) => call.tableName === "answer_traces")).toBe(false);
    });

    it(`source keep still drains live whole-space Research writers (${dialect})`, async () => {
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
      ).resolves.toEqual({ drained: false });

      expect(
        calls.some(
          (call) => call.operation === "update" && call.tableName === "research_task_jobs",
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) => call.operation === "select" && call.tableName === "research_task_jobs",
        ),
      ).toBe(true);
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
      expect(childUpdates[0]?.params).toEqual([
        spaceId,
        sourceKeepJob.targetId,
        sourceKeepJob.id,
        sourceKeepJob.updatedAt,
      ]);
      expect(childUpdates[0]?.sql).toContain("lifecycle_state");
      expect(childUpdates[0]?.sql).toContain("active");
      expect(childUpdates[0]?.sql).toContain("deletion_job_id");
      expect(childUpdates[0]?.sql).toContain("deleting_at");
      expect(childUpdates[1]?.sql).toContain("deletion_job_id");
      expect(childUpdates[1]?.sql).toContain("IS NULL");
      const childResidue = calls.find(
        (call) => call.operation === "select" && call.tableName === "document_assets",
      );
      expect(childResidue?.sql).toContain("source_id");
    });

    it(`deletes opaque Research history for the whole space before target evidence cleanup (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const partialId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "research_task_partial_results") {
          return result([{ id: partialId }]);
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
      expect(select?.sql).toContain("missingEvidence");
      expect(select?.sql).toContain("answer_traces");
      expect(select?.sql).toContain("knowledge_nodes");
      expect(select?.sql).toContain(dialect === "postgres" ? "jsonb_array_elements" : "JSON_TABLE");
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
      expect(select?.params).toEqual(["tenant-a", spaceId, targetDocumentId, 4]);
      expect(select?.sql).toContain("target_type");
      expect(select?.sql).toContain("target_id");
      expect(select?.sql).toContain("virtual_path");
      expect(select?.sql).toContain("parse_artifacts");
      expect(select?.sql).toContain("index_projections");
      expect(select?.sql).toContain("knowledge_paths");
      expect(select?.sql).toContain("knowledge_space_staged_commits");
      expect(select?.sql).not.toContain('target_lease."document_asset_id"');
      expect(select?.sql).not.toContain("target_lease.`document_asset_id`");
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

      for (let page = 0; page < 7; page += 1) {
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
      ]);
      const pathSelect = calls.find(
        (call) => call.operation === "select" && call.tableName === "knowledge_paths",
      );
      expect(pathSelect?.sql).toContain("resource_type");
      expect(pathSelect?.sql).toContain("document");
      expect(pathSelect?.sql).toContain("documentAssetIds");
      expect(pathSelect?.sql).toContain("sourceSummaryNodeIds");
      expect(pathSelect?.sql).toContain("communityId");
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
          job: job(),
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
          job: job(),
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
      expect(overview?.params).toEqual([
        logicalJob.tenantId,
        logicalJob.knowledgeSpaceId,
        7,
        logicalJob.targetId,
      ]);
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
      expect(aggregateDelete?.params).toEqual([
        documentJob.tenantId,
        documentJob.knowledgeSpaceId,
        documentJob.targetId,
      ]);
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

function capabilitiesFor(
  dialect: DatabaseAdapter["dialect"],
  execute: DatabaseExecutor["execute"],
  generatePublicationId?: string,
) {
  const fencedExecute: DatabaseExecutor["execute"] = async (input) => {
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
