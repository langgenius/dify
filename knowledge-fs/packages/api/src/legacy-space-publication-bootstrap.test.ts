import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceDocumentMutationDeletionActiveError,
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAdmissionError,
  LegacySpacePublicationBootstrapSnapshotConflictError,
  LegacySpacePublicationBootstrapVerificationError,
  createDatabaseLegacySpacePublicationBootstrapRepository,
} from "./legacy-space-publication-bootstrap";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const bootstrapId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

describe.each(["postgres", "tidb"] as const)(
  "legacy publication bootstrap admission (%s)",
  (dialect) => {
    it("fences ordinary compilation and document mutation while allowing only its internal child", async () => {
      const fake = admissionDatabase(dialect, { bootstrap: queuedBootstrapRow() });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database: fake.database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.assertCompilationAdmission({ knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAdmissionError);
      await expect(
        repository.assertDocumentMutationAdmission({ knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAdmissionError);
      await expect(
        repository.assertCompilationAdmission({
          bootstrapJobId: bootstrapId,
          knowledgeSpaceId,
          tenantId,
        }),
      ).resolves.toBeUndefined();
      await expect(repository.isQueryReady({ knowledgeSpaceId, tenantId })).resolves.toBe(false);
      fake.assertPlaceholderArity();
    });

    it("detects an unmarked legacy space and never treats a later upload as readiness", async () => {
      const fake = admissionDatabase(dialect, { legacy: true });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database: fake.database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(repository.isQueryReady({ knowledgeSpaceId, tenantId })).resolves.toBe(false);
      await expect(
        repository.assertDocumentMutationAdmission({ knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAdmissionError);
      await expect(
        repository.assertCompilationAdmission({ knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAdmissionError);

      const legacySql = fake.calls.find(
        (call) => call.tableName === "knowledge_spaces" && call.sql.includes("legacy_exists"),
      )?.sql;
      for (const table of [
        "knowledge_nodes",
        "index_projections",
        "document_outlines",
        "document_multimodal_manifests",
        "knowledge_paths",
        "graph_entities",
        "graph_relations",
      ]) {
        expect(legacySql).toContain(table);
      }
      fake.assertPlaceholderArity();
    });

    it("opens the latch only for a completed ledger and permits future mutations", async () => {
      const fake = admissionDatabase(dialect, { bootstrap: succeededBootstrapRow() });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database: fake.database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(repository.isQueryReady({ knowledgeSpaceId, tenantId })).resolves.toBe(true);
      await expect(
        repository.assertCompilationAdmission({ knowledgeSpaceId, tenantId }),
      ).resolves.toBeUndefined();
      await expect(
        repository.assertDocumentMutationAdmission({ knowledgeSpaceId, tenantId }),
      ).resolves.toBeUndefined();
      fake.assertPlaceholderArity();
    });

    it("refuses final visibility when an asset was added after the frozen snapshot", async () => {
      const execute = async (input: DatabaseExecuteInput) => {
        if (input.tableName === "legacy_space_publication_bootstraps") {
          return { rows: [verifyingBootstrapRow()], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" &&
          input.sql.includes("COUNT(*)")
        ) {
          return { rows: [{ item_count: 1 }], rowsAffected: 0 };
        }
        if (input.tableName === "legacy_space_publication_bootstrap_items") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "document_assets") {
          return { rows: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49" }], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected completion query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.complete({
          expectedRowVersion: 8,
          jobId: bootstrapId,
          leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          now: "2026-07-14T12:05:00.000Z",
        }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapSnapshotConflictError);
    });

    it("keeps the latch closed for a corrupt flattened PageIndex build", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "legacy_space_publication_bootstraps") {
          return { rows: [verifyingBootstrapRow()], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.sql.includes("COUNT(*) AS") && input.tableName.includes("bootstrap_items")) {
          return { rows: [{ item_count: 1 }], rowsAffected: 0 };
        }
        if (input.tableName === "legacy_space_publication_bootstrap_items") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "document_assets") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return {
            rows: [
              {
                fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
                head_revision: 3,
                publication_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
              },
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "projection_set_publication_members" &&
          input.sql.includes("page_index_manifests")
        ) {
          return { rows: [{ document_asset_id: documentId() }], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected corrupt PageIndex query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.complete({
          expectedRowVersion: 8,
          jobId: bootstrapId,
          leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          now: "2026-07-14T12:05:00.000Z",
        }),
      ).rejects.toThrow("generation-closed PageIndex and FTS corpus");
      const verifier = calls.find((call) => call.sql.includes("page_index_manifests"))?.sql ?? "";
      expect(verifier).toContain("tokenizer_version");
      expect(verifier).toContain("pageindex-nfkc-exact-v1");
      expect(verifier).toContain("checksum");
      expect(verifier).toContain("node_count");
      expect(verifier).toContain("term_count");
      expect(verifier).toContain("page_index_terms");
      expect(verifier).toContain("page_index_nodes");
      expect(verifier).toContain("page_index_node_id");
      expect(verifier).toContain("knowledge_space_id");
    });

    it("verifies the active dense vector space and Graph source publication closure", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (
          input.tableName === "legacy_space_publication_bootstraps" &&
          input.operation === "select"
        ) {
          return { rows: [verifyingBootstrapRow()], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" &&
          input.sql.includes("COUNT(*) AS")
        ) {
          return { rows: [{ item_count: 1 }], rowsAffected: 0 };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" ||
          input.tableName === "document_assets" ||
          input.tableName === "projection_set_publication_members"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return {
            rows: [
              {
                fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
                head_revision: 4,
                publication_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
              },
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "legacy_space_publication_bootstraps" &&
          input.operation === "update"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected closure query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.complete({
          expectedRowVersion: 8,
          jobId: bootstrapId,
          leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          now: "2026-07-14T12:05:00.000Z",
        }),
      ).resolves.toMatchObject({ checkpoint: "published", runState: "succeeded" });
      const denseVerifier =
        calls.find((call) => call.sql.includes("__knowledgeFsEmbeddingProfile"))?.sql ?? "";
      expect(denseVerifier).toContain("vectorSpaceId");
      expect(denseVerifier).toContain("__knowledgeFsEmbeddingProfile");
      expect(denseVerifier).toContain(
        dialect === "postgres"
          ? "-> '__knowledgeFsEmbeddingProfile' ->> 'vectorSpaceId'"
          : "$.__knowledgeFsEmbeddingProfile.vectorSpaceId",
      );
      expect(denseVerifier).not.toContain("$.embeddingProfile.vectorSpaceId");
      expect(denseVerifier).not.toContain("-> 'embeddingProfile'");
      expect(denseVerifier).toContain("'dense-vector'");
      expect(denseVerifier).not.toMatch(/= 'dense'/);
      expect(denseVerifier).toContain("publication_generation_id");
      const graphVerifier = calls.find((call) => call.sql.includes("source_pm"))?.sql ?? "";
      expect(graphVerifier).toContain("source_ip");
      expect(graphVerifier).toContain("publication_id");
      expect(graphVerifier).toContain("document_asset_id");
      expect(graphVerifier).toContain("knowledge_space_id");
    });

    it("rejects zero-document completion while legacy null-generation state remains", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let updates = 0;
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "legacy_space_publication_bootstraps") {
          if (input.operation === "update") {
            updates += 1;
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [verifyingEmptyBootstrapRow()], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          if (input.sql.includes("legacy_exists")) {
            return { rows: [{ legacy_exists: 1 }], rowsAffected: 0 };
          }
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" &&
          input.sql.includes("COUNT(*)")
        ) {
          return { rows: [{ item_count: 0 }], rowsAffected: 0 };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" ||
          input.tableName === "document_assets"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected empty legacy completion query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.complete({
          expectedRowVersion: 8,
          jobId: bootstrapId,
          leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          now: "2026-07-14T12:05:00.000Z",
        }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapVerificationError);
      expect(updates).toBe(0);
      await expect(repository.isQueryReady({ knowledgeSpaceId, tenantId })).resolves.toBe(false);
      await expect(
        repository.assertDocumentMutationAdmission({ knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAdmissionError);
      const legacySql = calls.find((call) => call.sql.includes("legacy_exists"))?.sql ?? "";
      for (const table of [
        "knowledge_nodes",
        "index_projections",
        "document_outlines",
        "document_multimodal_manifests",
        "knowledge_paths",
        "graph_entities",
        "graph_relations",
      ]) {
        expect(legacySql).toContain(table);
      }
      expect(calls.find((call) => call.tableName === "knowledge_spaces")?.sql).toContain(
        "FOR UPDATE",
      );
    });

    it("allows zero-document completion for a truly empty space", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "legacy_space_publication_bootstraps") {
          if (input.operation === "update") {
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [verifyingEmptyBootstrapRow()], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          if (input.sql.includes("legacy_exists")) {
            return { rows: [], rowsAffected: 0 };
          }
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" &&
          input.sql.includes("COUNT(*)")
        ) {
          return { rows: [{ item_count: 0 }], rowsAffected: 0 };
        }
        if (
          input.tableName === "legacy_space_publication_bootstrap_items" ||
          input.tableName === "document_assets"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected true-empty completion query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.complete({
          expectedRowVersion: 8,
          jobId: bootstrapId,
          leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          now: "2026-07-14T12:05:00.000Z",
        }),
      ).resolves.toMatchObject({
        checkpoint: "published",
        completedDocuments: 0,
        runState: "succeeded",
        totalDocuments: 0,
      });
      expect(
        calls.some(
          (call) =>
            call.tableName === "legacy_space_publication_bootstraps" && call.operation === "update",
        ),
      ).toBe(true);
    });

    it("serializes mutation lease acquisition and bootstrap snapshot capture on the space row", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let leaseActive = false;
      let leaseRow: Record<string, unknown> | undefined;
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces" && input.sql.includes("legacy_exists")) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "legacy_space_publication_bootstraps") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_mutation_leases") {
          if (input.operation === "select") {
            return { rows: leaseActive && leaseRow ? [leaseRow] : [], rowsAffected: 0 };
          }
          if (input.operation === "insert") {
            leaseActive = true;
            leaseRow = {
              acquired_at: "2026-07-14T13:00:00.000Z",
              expires_at: "2026-07-14T13:05:00.000Z",
              heartbeat_at: "2026-07-14T13:00:00.000Z",
              id: input.params[0],
              knowledge_space_id: input.params[2],
              lease_token: input.params[4],
              operation: input.params[3],
              tenant_id: input.params[1],
            };
            return { rows: input.maxRows > 0 ? [leaseRow] : [], rowsAffected: 1 };
          }
          if (input.operation === "delete") {
            if (input.params.length === 4) leaseActive = false;
            return { rows: [], rowsAffected: 1 };
          }
        }
        throw new Error(`Unexpected mutation lease query for ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database,
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      const lease = await repository.acquireDocumentMutationLease({
        acquiredAt: "2026-07-14T12:00:00.000Z",
        knowledgeSpaceId,
        operation: "upload",
        tenantId,
      });
      expect(calls[0]).toMatchObject({ operation: "select", tableName: "knowledge_spaces" });
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      await expect(
        repository.start({
          createdAt: "2026-07-14T12:01:00.000Z",
          id: bootstrapId,
          idempotencyKey: "legacy-space-publication-bootstrap-v1",
          knowledgeSpaceId,
          tenantId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceDocumentMutationLeaseActiveError);
      await repository.releaseDocumentMutationLease(lease);
      expect(leaseActive).toBe(false);
    });

    it("heartbeats and releases mutation leases with an expiry and ABA-safe token fence", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let currentToken: string | undefined;
      let leaseRow: Record<string, unknown> | undefined;
      const replacementToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f99";
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces" && input.sql.includes("legacy_exists")) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "legacy_space_publication_bootstraps") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_mutation_leases") {
          if (input.operation === "select") {
            return { rows: leaseRow ? [leaseRow] : [], rowsAffected: 0 };
          }
          if (input.operation === "insert") {
            currentToken = String(input.params[4]);
            leaseRow = {
              acquired_at: "2026-07-14T13:00:00.000Z",
              expires_at: "2026-07-14T13:05:00.000Z",
              heartbeat_at: "2026-07-14T13:00:00.000Z",
              id: input.params[0],
              knowledge_space_id: input.params[2],
              lease_token: input.params[4],
              operation: input.params[3],
              tenant_id: input.params[1],
            };
            return { rows: input.maxRows > 0 ? [leaseRow] : [], rowsAffected: 1 };
          }
          if (input.operation === "update") {
            const owned = input.params[3] === currentToken;
            if (owned && leaseRow) {
              leaseRow = {
                ...leaseRow,
                expires_at: "2026-07-14T13:06:00.000Z",
                heartbeat_at: "2026-07-14T13:01:00.000Z",
              };
            }
            return {
              rows: owned && leaseRow && input.maxRows > 0 ? [leaseRow] : [],
              rowsAffected: owned ? 1 : 0,
            };
          }
          if (input.params.length === 4) {
            return {
              rows: [],
              rowsAffected: input.params.includes(currentToken ?? "missing") ? 1 : 0,
            };
          }
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected mutation lease query for ${input.tableName}`);
      };
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });
      const lease = await repository.acquireDocumentMutationLease({
        acquiredAt: "2026-07-14T12:00:00.000Z",
        knowledgeSpaceId,
        operation: "upload",
        tenantId,
      });

      // The caller is one hour behind the database. Lease time still comes exclusively from DB.
      expect(lease.heartbeatAt).toBe("2026-07-14T13:00:00.000Z");
      expect(lease.expiresAt).toBe("2026-07-14T13:05:00.000Z");
      await expect(
        repository.heartbeatDocumentMutationLease(lease, "2026-07-14T12:01:00.000Z"),
      ).resolves.toMatchObject({ expiresAt: "2026-07-14T13:06:00.000Z" });

      currentToken = replacementToken;
      await expect(
        repository.heartbeatDocumentMutationLease(lease, "2026-07-14T12:02:00.000Z"),
      ).rejects.toThrow("heartbeat was lost");
      await expect(repository.releaseDocumentMutationLease(lease)).rejects.toThrow(
        "lease was lost",
      );

      const cleanup = calls.find(
        (call) =>
          call.operation === "delete" &&
          call.tableName === "knowledge_space_mutation_leases" &&
          call.params.length === 2,
      );
      expect(cleanup?.sql).toContain("expires_at");
      expect(cleanup?.sql).toContain("CURRENT_TIMESTAMP");
      const heartbeat = calls.find(
        (call) =>
          call.operation === "update" && call.tableName === "knowledge_space_mutation_leases",
      );
      expect(heartbeat?.sql).toContain("lease_token");
      expect(heartbeat?.sql).toContain("expires_at");
      const release = calls.find(
        (call) =>
          call.operation === "delete" &&
          call.tableName === "knowledge_space_mutation_leases" &&
          call.params.length === 4,
      );
      expect(release?.params[3]).toBe(lease.leaseToken);
      expect(release?.sql).toContain("lease_token");
    });

    it("rejects a document mutation lease after durable deletion admission", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [{ id: bootstrapId }], rowsAffected: 0 };
        }
        throw new Error(`Unexpected deletion admission query for ${input.tableName}`);
      };
      const repository = createDatabaseLegacySpacePublicationBootstrapRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        maxClaimBatchSize: 10,
        maxDocuments: 100,
        maxInsertBatchSize: 10,
      });

      await expect(
        repository.acquireDocumentMutationLease({
          acquiredAt: "2026-07-14T12:00:00.000Z",
          knowledgeSpaceId,
          operation: "upload",
          tenantId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceDocumentMutationDeletionActiveError);
      expect(calls.map((call) => call.tableName)).toEqual(["knowledge_spaces", "deletion_jobs"]);
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[1]?.sql).toContain("active_slot");
      expect(calls[1]?.sql).toContain("FOR UPDATE");
      expect(calls.some((call) => call.tableName === "knowledge_space_mutation_leases")).toBe(
        false,
      );
    });
  },
);

function admissionDatabase(
  dialect: DatabaseAdapter["dialect"],
  options: { bootstrap?: Record<string, unknown>; legacy?: boolean },
) {
  const calls: DatabaseExecuteInput[] = [];
  const database = createSchemaDatabaseAdapter({
    executor: async (input) => {
      calls.push(input);
      if (input.tableName === "legacy_space_publication_bootstraps") {
        return {
          rows: options.bootstrap ? [structuredClone(options.bootstrap)] : [],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "knowledge_spaces" && input.sql.includes("legacy_exists")) {
        return { rows: options.legacy ? [{ legacy_exists: 1 }] : [], rowsAffected: 0 };
      }
      throw new Error(`Unexpected admission query for ${input.tableName}`);
    },
    kind: dialect,
  });
  return {
    assertPlaceholderArity: () => {
      for (const input of calls) {
        if (dialect === "tidb") {
          expect(input.sql.match(/\?/gu) ?? []).toHaveLength(input.params.length);
        } else {
          const indexes = [...input.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
          expect(Math.max(0, ...indexes)).toBe(input.params.length);
        }
      }
    },
    calls,
    database,
  };
}

function queuedBootstrapRow(): Record<string, unknown> {
  return {
    checkpoint: "snapshot_captured",
    completed_at: null,
    completed_documents: 0,
    created_at: "2026-07-14T12:00:00.000Z",
    heartbeat_at: null,
    id: bootstrapId,
    idempotency_key: "legacy-space-publication-bootstrap-v1",
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    published_fingerprint: null,
    published_head_revision: null,
    published_publication_id: null,
    row_version: 0,
    run_state: "queued",
    snapshot_metadata: { schemaVersion: 1 },
    tenant_id: tenantId,
    total_documents: 1,
    updated_at: "2026-07-14T12:00:00.000Z",
    worker_id: null,
  };
}

function succeededBootstrapRow(): Record<string, unknown> {
  return {
    ...queuedBootstrapRow(),
    checkpoint: "published",
    completed_at: "2026-07-14T12:10:00.000Z",
    completed_documents: 0,
    row_version: 9,
    run_state: "succeeded",
    total_documents: 0,
    updated_at: "2026-07-14T12:10:00.000Z",
  };
}

function verifyingBootstrapRow(): Record<string, unknown> {
  return {
    ...queuedBootstrapRow(),
    checkpoint: "verifying",
    completed_documents: 1,
    heartbeat_at: "2026-07-14T12:04:00.000Z",
    lease_expires_at: "2026-07-14T12:10:00.000Z",
    lease_token: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    row_version: 8,
    run_state: "running",
    worker_id: "bootstrap-worker-1",
  };
}

function verifyingEmptyBootstrapRow(): Record<string, unknown> {
  return {
    ...verifyingBootstrapRow(),
    completed_documents: 0,
    total_documents: 0,
  };
}

function documentId(): string {
  return "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
}
