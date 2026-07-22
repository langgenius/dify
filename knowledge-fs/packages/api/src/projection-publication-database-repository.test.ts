import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentCompilationPublicationMemberSnapshot,
  DuplicateProjectionSetPublicationError,
  ProjectionSetPublicationAttemptFenceConflictError,
  ProjectionSetPublicationCandidateSnapshotConflictError,
  ProjectionSetPublicationDeletionFenceConflictError,
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationKnowledgeSpaceNotFoundError,
  ProjectionSetPublicationListLimitExceededError,
  ProjectionSetPublicationNotFoundError,
  ProjectionSetPublicationProfileBindingConflictError,
  ProjectionSetPublicationProfileFenceConflictError,
  ProjectionSetPublicationTransitionError,
  createDatabaseProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const otherTenantId = "tenant-2";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const otherKnowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const fingerprintA = `projection-set-sha256:${"a".repeat(64)}`;
const fingerprintB = `projection-set-sha256:${"b".repeat(64)}`;
const fingerprintC = `projection-set-sha256:${"c".repeat(64)}`;
const setIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const setIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const setIdC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const otherSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a";
const outlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b";
const multimodalManifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4c";
const knowledgePathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4d";
const graphEntityAId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4e";
const graphEntityBId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4f";
const graphRelationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
const sourceNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51";
const inheritedDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const inheritedGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
const inheritedProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54";
const inheritedSourceNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55";
const embeddingProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56";
const embeddingProfileDigest = "d".repeat(64);
const retrievalProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c57";
const retrievalProfileDigest = "e".repeat(64);
const embeddingVectorSpaceId = `embedding-space-sha256:${"f".repeat(64)}`;
const logicalDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d60";
const leafChunkNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61";
const sectionSummaryNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d62";
const documentSummaryNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d63";
const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d64";
const permissionMemberId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d65";
const permissionPolicyId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d66";
const permissionApiAccessId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d67";
const permissionApiKeyId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d68";
const requestedBySubjectId = "editor-1";
const permissionSnapshotRevision = 8;

type Dialect = DatabaseAdapter["dialect"];
type PublicationRow = Record<string, unknown>;

interface HeadRow {
  created_at: string;
  head_revision: number;
  id: string;
  knowledge_space_id: string;
  publication_id: string;
  tenant_id: string;
  updated_at: string;
}

interface FakePublicationDatabase {
  readonly calls: Array<{
    readonly input: DatabaseExecuteInput;
    readonly lane: "outside" | "transaction";
  }>;
  readonly database: DatabaseAdapter;
  advancePublicationPermissionRevision(): void;
  clearAttemptPermissionProvenance(kind: "missing" | "partial"): void;
  corruptReadyPageIndexClosure(): void;
  existingProfileBinding(kind: "conflicting" | "exact"): void;
  injectFirstHeadRace(publicationId: string): void;
  injectDeletionTombstoneAfterAttemptFence(): void;
  injectMemberDocumentTombstone(documentAssetId: string): void;
  markIndexProjectionReady(): void;
  profileBindingCount(): number;
  removePublicationPartialMember(): void;
  revokePublicationMember(): void;
  setPublicationApiKeyState(state: "expired" | "revoked"): void;
  markSpaceDeleting(): void;
  removeReadyPageIndex(): void;
  rejectAttemptFence(): void;
  rejectTargetClosure(): void;
  rejectMemberSnapshot(): void;
  rejectPageIndexPromotion(): void;
  rejectProfileFence(): void;
  rejectProjectionPromotion(): void;
  rejectAssetRevision(): void;
  rejectNodeProjectionClosure(kind: "dense" | "fts" | "orphan"): void;
  useFullTargetClosure(): void;
  useLogicalDocumentHierarchy(): void;
  useEmbeddingProfileFence(): void;
  usePartialMemberPermission(): void;
}

describe.each(["postgres", "tidb"] as const)(
  "database projection publication repository (%s)",
  (dialect) => {
    it("rejects values that TiDB INSERT IGNORE could truncate before issuing SQL", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 2,
      });

      await expect(
        repository.createCandidate(candidate({ tenantId: "x".repeat(256) })),
      ).rejects.toThrow("Projection set publication tenantId must be at most 255 characters");
      await expect(
        repository.createCandidate(candidate({ createdAt: "not-a-date" })),
      ).rejects.toThrow("Projection set publication createdAt must be an ISO date-time");
      await expect(
        repository.createCandidate(candidate({ createdAt: "0000-01-01T00:00:00.000Z" })),
      ).rejects.toThrow("Projection set publication createdAt year must be between 1000 and 9999");
      await expect(
        repository.createCandidate(candidate({ projectionVersion: 2_147_483_648 })),
      ).rejects.toThrow(
        "Projection set publication projectionVersion must be between 1 and 2147483647",
      );
      expect(fake.calls).toEqual([]);

      await expect(
        repository.createCandidate(candidate({ createdAt: "2026-05-27T12:00:00Z" })),
      ).resolves.toMatchObject({
        createdAt: "2026-05-27T12:00:00.000Z",
        updatedAt: "2026-05-27T12:00:00.000Z",
      });
      const callCount = fake.calls.length;
      await expect(repository.validate(transition(fingerprintA, "not-a-date"))).rejects.toThrow(
        "Projection set publication updatedAt must be an ISO date-time",
      );
      await expect(
        repository.listGcCandidates({
          knowledgeSpaceId,
          limit: 1,
          olderThan: "not-a-date",
          tenantId,
        }),
      ).rejects.toThrow("Projection set publication olderThan must be an ISO date-time");
      await expect(
        repository.listGcCandidates({
          cursor: "",
          knowledgeSpaceId,
          limit: 1,
          olderThan: "2026-06-01T00:00:00.000Z",
          tenantId,
        }),
      ).rejects.toThrow();
      expect(fake.calls).toHaveLength(callCount);
    });

    it("creates candidates, rejects duplicates, validates, deactivates, and deletes", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 2,
      });

      await expect(repository.createCandidate(candidate())).resolves.toMatchObject({
        fingerprint: fingerprintA,
        status: "candidate",
      });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ fingerprint: fingerprintA, status: "candidate" });
      await expect(repository.createCandidate(candidate())).rejects.toBeInstanceOf(
        DuplicateProjectionSetPublicationError,
      );
      await expect(
        repository.createCandidate(candidate({ id: otherSetId, tenantId: otherTenantId })),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationKnowledgeSpaceNotFoundError);
      await expect(
        repository.validate(transition(fingerprintA, "2026-05-27T12:01:00.000Z")),
      ).resolves.toMatchObject({ status: "validating" });
      await expect(
        repository.deactivate(transition(fingerprintA, "2026-05-27T12:02:00.000Z")),
      ).resolves.toMatchObject({ status: "inactive" });
      await expect(
        repository.validate(transition(fingerprintA, "2026-05-27T12:02:30.000Z")),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
      const beforeDelete = fake.calls.length;
      await expect(
        repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ fingerprint: fingerprintA, status: "inactive" });
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toBeNull();
      await expect(
        repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toBeNull();
      await expect(
        repository.deactivate(transition(fingerprintA, "2026-05-27T12:03:00.000Z")),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationNotFoundError);

      expect(
        fake.calls
          .slice(beforeDelete)
          .filter((call) => call.lane === "transaction")
          .slice(0, 2)
          .map((call) => call.input.tableName),
      ).toEqual(["projection_set_publication_heads", "projection_set_publications"]);

      expect(fake.calls.find((call) => call.input.operation === "insert")?.input.sql).toContain(
        dialect === "postgres" ? "INSERT INTO" : "INSERT IGNORE INTO",
      );
      expect(fake.calls.some((call) => call.lane === "transaction")).toBe(true);
    });

    it("publishes with strict head CAS, rolls back, and never mutates a stale candidate", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      await repository.createCandidate(candidate({ fingerprint: fingerprintC, id: setIdC }));

      const first = await repository.publish({
        ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
        expectedHeadRevision: 0,
      });
      expect(first).toMatchObject({
        headRevision: 1,
        published: { fingerprint: fingerprintA, headRevision: 1, status: "published" },
      });

      const beforeSecondPublish = fake.calls.length;
      const second = await repository.publish({
        ...transition(fingerprintB, "2026-05-27T12:02:00.000Z"),
        expectedHeadRevision: 1,
      });
      expect(second).toMatchObject({
        headRevision: 2,
        published: { fingerprint: fingerprintB, headRevision: 2, status: "published" },
        superseded: {
          fingerprint: fingerprintA,
          status: "superseded",
          supersededByFingerprint: fingerprintB,
        },
      });
      expect(
        fake.calls.slice(beforeSecondPublish).every((call) => call.lane === "transaction"),
      ).toBe(true);
      expect(
        fake.calls
          .slice(beforeSecondPublish, beforeSecondPublish + 2)
          .map((call) => call.input.tableName),
      ).toEqual(["knowledge_spaces", "projection_set_publication_heads"]);
      expect(fake.calls[beforeSecondPublish]?.input.sql).toContain("FOR UPDATE");

      await expect(
        repository.publish({
          ...transition(fingerprintC, "2026-05-27T12:03:00.000Z"),
          expectedHeadRevision: 1,
        }),
      ).rejects.toMatchObject({ actualHeadRevision: 2, expectedHeadRevision: 1 });
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintC, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintB,
        headRevision: 2,
      });

      fake.markIndexProjectionReady();
      const rollback = await repository.rollback({
        ...transition(fingerprintA, "2026-05-27T12:04:00.000Z"),
        expectedHeadRevision: 2,
      });
      expect(rollback).toMatchObject({
        headRevision: 3,
        published: { fingerprint: fingerprintA, headRevision: 3, status: "published" },
        superseded: { fingerprint: fingerprintB, status: "superseded" },
      });
      await expect(
        repository.deactivate(transition(fingerprintB, "2026-05-27T12:05:00.000Z")),
      ).resolves.toMatchObject({
        status: "inactive",
        supersededByFingerprint: fingerprintA,
      });
      await expect(
        repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
    });

    it("turns a concurrent first-head winner into a conflict and rolls back publication changes", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      fake.injectFirstHeadRace(setIdB);

      const publish = repository.publish({
        ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
        expectedHeadRevision: 0,
      });

      await expect(publish).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
      await expect(publish).rejects.toMatchObject({
        actualHeadRevision: 1,
        expectedHeadRevision: 0,
      });
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintB,
        headRevision: 1,
        status: "published",
      });
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "published" });
    });

    it("refuses rollback before a retained superseded PageIndex is completely backfilled", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      fake.useFullTargetClosure();
      await repository.createCandidate(candidate());
      await repository.publishDocumentCompilationCandidate({
        ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
        attemptFence: publicationFence(setIdA),
        expectedHeadRevision: 0,
        expectedMembers: fullPublicationMembers(),
      });
      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      await repository.publish({
        ...transition(fingerprintB, "2026-05-27T12:02:00.000Z"),
        expectedHeadRevision: 1,
      });
      fake.removeReadyPageIndex();

      await expect(
        repository.rollback({
          ...transition(fingerprintA, "2026-05-27T12:03:00.000Z"),
          expectedHeadRevision: 2,
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintB,
        headRevision: 2,
      });
    });

    it("refuses rollback when a retained PageIndex term points outside its manifest closure", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      fake.useFullTargetClosure();
      await repository.createCandidate(candidate());
      await repository.publishDocumentCompilationCandidate({
        ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
        attemptFence: publicationFence(setIdA),
        expectedHeadRevision: 0,
        expectedMembers: fullPublicationMembers(),
      });
      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      await repository.publish({
        ...transition(fingerprintB, "2026-05-27T12:02:00.000Z"),
        expectedHeadRevision: 1,
      });
      fake.corruptReadyPageIndexClosure();
      const beforeRollback = fake.calls.length;

      await expect(
        repository.rollback({
          ...transition(fingerprintA, "2026-05-27T12:03:00.000Z"),
          expectedHeadRevision: 2,
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      const pageIndexCheck = fake.calls
        .slice(beforeRollback)
        .find(
          (call) =>
            call.input.tableName === "page_index_manifests" && call.input.operation === "select",
        );
      expect(pageIndexCheck?.input.sql).toContain("NOT EXISTS");
      expect(pageIndexCheck?.input.sql).toContain("page_index_node_id");
      expect(pageIndexCheck?.input.sql).toContain("closure_n");
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintB,
        headRevision: 2,
      });
    });

    it("validates and publishes a document candidate under one live attempt fence and head CAS", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      const beforePublication = fake.calls.length;

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).resolves.toMatchObject({
        headRevision: 1,
        published: { fingerprint: fingerprintA, status: "published" },
      });
      const publicationCalls = fake.calls.slice(beforePublication);
      const attemptCall = publicationCalls.find(
        (call) => call.input.tableName === "document_compilation_attempts",
      );
      expect(attemptCall).toMatchObject({ lane: "transaction" });
      expect(attemptCall?.input.sql).toContain("FOR UPDATE");
      expect(attemptCall?.input.sql).toContain("smoke_eval_passed");
      expect(attemptCall?.input.sql).toContain("permission_snapshot_id");
      expect(attemptCall?.input.sql).toContain("permission_snapshot_revision");
      expect(attemptCall?.input.sql).toContain("access_channel");
      expect(attemptCall?.input.sql).toContain("requested_by_subject_id");
      expect(publicationCalls.slice(0, 7).map((call) => call.input.tableName)).toEqual([
        "knowledge_spaces",
        "document_compilation_attempts",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "knowledge_space_permission_snapshots",
      ]);
      const finalPermissionFence = publicationCalls.reduce(
        (lastIndex, call, index) =>
          call.input.tableName === "knowledge_space_permission_snapshots" ? index : lastIndex,
        -1,
      );
      const firstHeadRead = publicationCalls.findIndex(
        (call) =>
          call.input.tableName === "projection_set_publication_heads" &&
          call.input.operation === "select",
      );
      expect(finalPermissionFence).toBe(6);
      expect(firstHeadRead).toBeGreaterThan(finalPermissionFence);
      const memberCall = fake.calls.find(
        (call) => call.input.tableName === "projection_set_publication_members",
      );
      expect(memberCall?.input.sql).toContain("FOR UPDATE");
      const projectionCalls = fake.calls.filter(
        (call) => call.input.tableName === "index_projections",
      );
      expect(projectionCalls.map((call) => call.input.operation)).toEqual([
        "select",
        "update",
        "select",
      ]);
      expect(projectionCalls[0]?.input.sql).toContain("member_component_key");
      expect(projectionCalls[0]?.input.sql).toContain("FOR UPDATE");
      expect(projectionCalls[1]?.input.sql).toContain("projection_set_publication_members");
      expect(projectionCalls[1]?.input.sql).toContain("building");
      expect(projectionCalls[1]?.input.sql).toContain("ready");
      expect(projectionCalls[2]?.input.sql).toContain("LEFT JOIN");
      expect(projectionCalls[2]?.input.sql).toContain("status");
      const pageIndexCalls = fake.calls.filter(
        (call) => call.input.tableName === "page_index_manifests",
      );
      expect(pageIndexCalls.map((call) => call.input.operation)).toEqual(["update", "select"]);
      const lastPageIndexCall = pageIndexCalls.at(-1);
      const lastPageIndexCallPosition = lastPageIndexCall
        ? fake.calls.indexOf(lastPageIndexCall)
        : -1;
      const headMutation = fake.calls.findIndex(
        (call) =>
          call.input.tableName === "projection_set_publication_heads" &&
          (call.input.operation === "insert" || call.input.operation === "update"),
      );
      expect(lastPageIndexCallPosition).toBeGreaterThanOrEqual(0);
      expect(headMutation).toBeGreaterThan(lastPageIndexCallPosition);
      const assetCall = fake.calls.find((call) => call.input.tableName === "document_assets");
      expect(assetCall).toMatchObject({ lane: "transaction", input: { operation: "update" } });
      expect(assetCall?.input.sql).toContain("parser_status");
      expect(assetCall?.input.sql).toContain("version");
      const bindingInsert = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_publication_bindings" &&
          call.input.operation === "insert",
      );
      expect(bindingInsert).toMatchObject({ lane: "transaction" });
      expect(bindingInsert?.input.params).toEqual([
        setIdA,
        tenantId,
        knowledgeSpaceId,
        "content",
        "content-publication",
        null,
        null,
        null,
        null,
        "retrieval",
        retrievalProfileRevisionId,
        7,
        retrievalProfileDigest,
        null,
        setIdA,
        fingerprintA,
        "2026-05-27T12:01:00.000Z",
        "2026-05-27T12:01:00.000Z",
      ]);
      expect(bindingInsert ? fake.calls.indexOf(bindingInsert) : -1).toBeLessThan(headMutation);
      expect(fake.profileBindingCount()).toBe(1);

      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      fake.rejectMemberSnapshot();
      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintB, "2026-05-27T12:02:00.000Z"),
          attemptFence: publicationFence(setIdB),
          expectedHeadRevision: 1,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });

      await repository.createCandidate(candidate({ fingerprint: fingerprintC, id: setIdC }));
      fake.rejectAttemptFence();
      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintC, "2026-05-27T12:03:00.000Z"),
          attemptFence: publicationFence(setIdC),
          expectedHeadRevision: 1,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationAttemptFenceConflictError);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintC, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintA,
        headRevision: 1,
      });
    });

    it("materializes summary-tree child edges as parent chunk ids in parent-first order", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useLogicalDocumentHierarchy();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
          logicalDocumentFence: {
            documentId: logicalDocumentId,
            expectedActiveRevision: null,
            expectedDocumentRowVersion: 0,
            revision: 1,
          },
        }),
      ).resolves.toMatchObject({ headRevision: 1 });

      const chunkInserts = fake.calls.filter(
        (call) =>
          call.input.tableName === "document_revision_chunks" && call.input.operation === "insert",
      );
      expect(chunkInserts.map((call) => call.input.params.slice(0, 7))).toEqual([
        [documentSummaryNodeId, tenantId, knowledgeSpaceId, logicalDocumentId, 1, null, 2],
        [
          sectionSummaryNodeId,
          tenantId,
          knowledgeSpaceId,
          logicalDocumentId,
          1,
          documentSummaryNodeId,
          1,
        ],
        [
          leafChunkNodeId,
          tenantId,
          knowledgeSpaceId,
          logicalDocumentId,
          1,
          sectionSummaryNodeId,
          0,
        ],
      ]);
      expect(chunkInserts).toHaveLength(3);
      expect(chunkInserts.every((call) => !call.input.sql.includes(", NULL,"))).toBe(true);
    });

    it.each(["missing", "partial"] as const)(
      "fails closed before publication when the attempt permission provenance is %s",
      async (kind) => {
        const fake = createFakePublicationDatabase(dialect);
        fake.useLogicalDocumentHierarchy();
        fake.clearAttemptPermissionProvenance(kind);
        const repository = createDatabaseProjectionSetPublicationRepository({
          database: fake.database,
          maxListLimit: 10,
        });
        await repository.createCandidate(candidate());
        const beforePublication = fake.calls.length;

        await expect(
          repository.publishDocumentCompilationCandidate({
            ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
            attemptFence: publicationFence(setIdA),
            expectedHeadRevision: 0,
            expectedMembers: [publicationMember()],
            logicalDocumentFence: logicalPublicationFence(),
          }),
        ).rejects.toBeInstanceOf(ProjectionSetPublicationAttemptFenceConflictError);

        const publicationCalls = fake.calls.slice(beforePublication);
        expect(publicationCalls.map((call) => call.input.tableName)).toEqual([
          "knowledge_spaces",
          "document_compilation_attempts",
        ]);
        expectNoDocumentPublicationEffects(publicationCalls);
      },
    );

    it("rejects publication after the initiating member is revoked", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useLogicalDocumentHierarchy();
      fake.revokePublicationMember();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      const beforePublication = fake.calls.length;

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
          logicalDocumentFence: logicalPublicationFence(),
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

      const publicationCalls = fake.calls.slice(beforePublication);
      expect(publicationCalls.map((call) => call.input.tableName)).toEqual([
        "knowledge_spaces",
        "document_compilation_attempts",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
      ]);
      expectNoDocumentPublicationEffects(publicationCalls);
    });

    it.each(["revoked", "expired"] as const)(
      "rejects publication after the initiating API key is %s",
      async (state) => {
        const fake = createFakePublicationDatabase(dialect);
        fake.useLogicalDocumentHierarchy();
        fake.setPublicationApiKeyState(state);
        const repository = createDatabaseProjectionSetPublicationRepository({
          database: fake.database,
          maxListLimit: 10,
        });
        await repository.createCandidate(candidate());
        const beforePublication = fake.calls.length;

        await expect(
          repository.publishDocumentCompilationCandidate({
            ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
            attemptFence: publicationFence(setIdA),
            expectedHeadRevision: 0,
            expectedMembers: [publicationMember()],
            logicalDocumentFence: logicalPublicationFence(),
          }),
        ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

        const publicationCalls = fake.calls.slice(beforePublication);
        expect(
          publicationCalls.some(
            (call) =>
              call.input.tableName === "knowledge_space_api_keys" &&
              call.input.sql.includes("FOR UPDATE"),
          ),
        ).toBe(true);
        expectNoDocumentPublicationEffects(publicationCalls);
      },
    );

    it("rejects publication after a partial-space member is removed from the policy", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useLogicalDocumentHierarchy();
      fake.usePartialMemberPermission();
      fake.removePublicationPartialMember();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      const beforePublication = fake.calls.length;

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
          logicalDocumentFence: logicalPublicationFence(),
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

      const publicationCalls = fake.calls.slice(beforePublication);
      const finalFence = publicationCalls.find(
        (call) =>
          call.input.tableName === "knowledge_space_permission_snapshots" &&
          call.input.sql.includes("knowledge_space_access_policy_members"),
      );
      expect(finalFence?.input.sql).toContain("partial_members");
      expectNoDocumentPublicationEffects(publicationCalls);
    });

    it("rejects publication after a mutable permission-scope revision changes", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useLogicalDocumentHierarchy();
      fake.advancePublicationPermissionRevision();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      const beforePublication = fake.calls.length;

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
          logicalDocumentFence: logicalPublicationFence(),
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

      const publicationCalls = fake.calls.slice(beforePublication);
      const finalFence = publicationCalls.find(
        (call) =>
          call.input.tableName === "knowledge_space_permission_snapshots" &&
          call.input.sql.includes("member_revision"),
      );
      expect(finalFence?.input.sql).toContain("access_policy_revision");
      expect(finalFence?.input.sql).toContain("api_access_revision");
      expectNoDocumentPublicationEffects(publicationCalls);
    });

    it("rolls back candidate promotion when a tombstone appears before the final head CAS", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      fake.injectDeletionTombstoneAfterAttemptFence();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationDeletionFenceConflictError);
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      const tombstoneProbe = fake.calls.find(
        (call) => call.input.tableName === "deletion_tombstones",
      );
      expect(tombstoneProbe).toMatchObject({ lane: "transaction" });
      expect(tombstoneProbe?.input.sql).toContain("knowledge_space");
      expect(tombstoneProbe?.input.sql).toContain("source");
      expect(tombstoneProbe?.input.sql).toContain("source_id");
      expect(tombstoneProbe?.input.sql).toContain("document_asset");
      expect(tombstoneProbe?.input.sql).toContain("logical_document");
      expect(tombstoneProbe?.input.sql).toContain("document_revisions");
      expect(tombstoneProbe?.input.params).toEqual([tenantId, knowledgeSpaceId, setIdA]);
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "projection_set_publication_heads" &&
            (call.input.operation === "insert" || call.input.operation === "update"),
        ),
      ).toBe(false);
    });

    it("keeps the publication head unchanged when an attempt's frozen profile is no longer active", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      fake.rejectProfileFence();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationProfileFenceConflictError);
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
    });

    it("publishes only when the active embedding head matches the attempt's exact revision and digest", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useEmbeddingProfileFence();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).resolves.toMatchObject({ headRevision: 1 });
      const embeddingFence = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_heads" &&
          call.input.params.includes(embeddingProfileRevisionId),
      );
      expect(embeddingFence?.input.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        embeddingProfileRevisionId,
        5,
        embeddingProfileDigest,
      ]);
      expect(embeddingFence?.input.sql).toContain("FOR UPDATE");
      const bindingInsert = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_publication_bindings" &&
          call.input.operation === "insert",
      );
      expect(bindingInsert?.input.params.slice(5, 14)).toEqual([
        "embedding",
        embeddingProfileRevisionId,
        5,
        embeddingProfileDigest,
        "retrieval",
        retrievalProfileRevisionId,
        7,
        retrievalProfileDigest,
        embeddingVectorSpaceId,
      ]);
    });

    it("reuses an identical activated content binding but rejects a different frozen tuple", async () => {
      const exact = createFakePublicationDatabase(dialect);
      const exactRepository = createDatabaseProjectionSetPublicationRepository({
        database: exact.database,
        maxListLimit: 10,
      });
      await exactRepository.createCandidate(candidate());
      exact.existingProfileBinding("exact");

      await expect(
        exactRepository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).resolves.toMatchObject({ headRevision: 1 });
      expect(
        exact.calls.filter(
          (call) =>
            call.input.tableName === "knowledge_space_profile_publication_bindings" &&
            call.input.operation === "insert",
        ),
      ).toHaveLength(0);
      expect(exact.profileBindingCount()).toBe(1);

      const conflicting = createFakePublicationDatabase(dialect);
      const conflictingRepository = createDatabaseProjectionSetPublicationRepository({
        database: conflicting.database,
        maxListLimit: 10,
      });
      await conflictingRepository.createCandidate(candidate());
      conflicting.existingProfileBinding("conflicting");

      await expect(
        conflictingRepository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationProfileBindingConflictError);
      await expect(
        conflictingRepository.getByFingerprint({
          fingerprint: fingerprintA,
          knowledgeSpaceId,
          tenantId,
        }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(
        conflictingRepository.getPublished({ knowledgeSpaceId, tenantId }),
      ).resolves.toBeNull();
    });

    it("rolls back the activated content binding when the publication-head CAS loses", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
      fake.injectFirstHeadRace(setIdB);

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
      expect(fake.profileBindingCount()).toBe(0);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
        fingerprint: fingerprintB,
        headRevision: 1,
      });
    });

    it("locks and validates the active space before every compilation publication read/write", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      const beforePublish = fake.calls.length;
      fake.markSpaceDeleting();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationDeletionFenceConflictError);

      const publicationCalls = fake.calls.slice(beforePublish);
      expect(publicationCalls).toHaveLength(1);
      expect(publicationCalls[0]).toMatchObject({
        lane: "transaction",
        input: { operation: "select", tableName: "knowledge_spaces" },
      });
      expect(publicationCalls[0]?.input.sql).toContain("FOR UPDATE");
      expect(publicationCalls[0]?.input.sql).toContain("lifecycle_state");
      expect(publicationCalls[0]?.input.sql).toContain("deletion_job_id");
    });

    it("rejects a candidate that inherits any member belonging to a tombstoned document", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useFullTargetClosure();
      fake.injectMemberDocumentTombstone(inheritedDocumentAssetId);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: fullPublicationMembers(),
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationDeletionFenceConflictError);
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });

      const probe = fake.calls.find((call) => call.input.tableName === "deletion_tombstones");
      expect(probe?.input.sql).toContain("projection_set_publication_members");
      expect(probe?.input.sql).toContain("document_asset_id");
      expect(probe?.input.sql).toContain("source_id");
      expect(probe?.input.params).toEqual([tenantId, knowledgeSpaceId, setIdA]);
    });

    it("locks the complete target closure while allowing cross-document generation graph edges", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useFullTargetClosure();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: fullPublicationMembers(),
        }),
      ).resolves.toMatchObject({
        headRevision: 1,
        published: { fingerprint: fingerprintA, status: "published" },
      });

      for (const tableName of [
        "document_outlines",
        "document_multimodal_manifests",
        "knowledge_paths",
        "index_projections",
        "graph_entities",
        "graph_relations",
        "knowledge_nodes",
      ]) {
        const targetCalls = fake.calls.filter((call) => call.input.tableName === tableName);
        expect(
          targetCalls.some(
            (call) => call.lane === "transaction" && call.input.sql.includes("FOR UPDATE"),
          ),
          tableName,
        ).toBe(true);
      }
      expect(
        fake.calls.find((call) => call.input.tableName === "knowledge_paths")?.input.sql,
      ).toContain("resource_type");
      expect(
        fake.calls.find(
          (call) =>
            call.input.tableName === "index_projections" &&
            call.input.sql.includes("member_component_key"),
        )?.input.sql,
      ).toContain("knowledge_nodes");
    });

    it("rolls back when a locked candidate member no longer resolves to its exact target", async () => {
      const fake = createFakePublicationDatabase(dialect);
      fake.useFullTargetClosure();
      fake.rejectTargetClosure();
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: fullPublicationMembers(),
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "index_projections" && call.input.operation === "update",
        ),
      ).toBe(false);
    });

    it.each(["orphan", "fts", "dense"] as const)(
      "rejects a candidate with an incomplete per-node %s projection closure",
      async (kind) => {
        const fake = createFakePublicationDatabase(dialect);
        fake.useFullTargetClosure();
        fake.rejectNodeProjectionClosure(kind);
        const repository = createDatabaseProjectionSetPublicationRepository({
          database: fake.database,
          maxListLimit: 10,
        });
        await repository.createCandidate(candidate());

        await expect(
          repository.publishDocumentCompilationCandidate({
            ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
            attemptFence: publicationFence(setIdA),
            expectedHeadRevision: 0,
            expectedMembers: fullPublicationMembers(),
          }),
        ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
        const closureCall = fake.calls.find(
          (call) =>
            call.input.tableName === "knowledge_nodes" &&
            call.input.sql.includes("candidate_has_fts"),
        );
        expect(closureCall?.input.sql).toContain("candidate_has_dense");
        expect(closureCall?.input.sql).toContain("publication_id");
        expect(closureCall?.input.sql).toContain("node_id");
        expect(closureCall?.input.sql).toContain("FOR UPDATE");
        if (dialect === "tidb") {
          expect(closureCall?.input.sql).toContain("index_projection_fts_postings");
          expect(closureCall?.input.sql).toContain("mixed-nfkc-v1");
        } else {
          expect(closureCall?.input.sql).not.toContain("index_projection_fts_postings");
        }
        if (closureCall) {
          expect(closureCall.input.params).toEqual([
            tenantId,
            knowledgeSpaceId,
            setIdA,
            documentAssetId,
            generationId,
            `embedding-space-sha256:${"a".repeat(64)}`,
            tenantId,
            knowledgeSpaceId,
            setIdA,
            documentAssetId,
            generationId,
            knowledgeSpaceId,
            documentAssetId,
            generationId,
          ]);
          if (dialect === "postgres") {
            const positions = [...closureCall.input.sql.matchAll(/\$(\d+)/g)].map((match) =>
              Number(match[1]),
            );
            expect(Math.max(...positions)).toBe(closureCall.input.params.length);
          } else {
            expect(closureCall.input.sql.match(/\?/g)?.length ?? 0).toBe(
              closureCall.input.params.length,
            );
          }
        }
        expect(
          fake.calls.some(
            (call) =>
              call.input.tableName === "projection_set_publication_heads" &&
              (call.input.operation === "insert" || call.input.operation === "update"),
          ),
        ).toBe(false);
      },
    );

    it("rolls back publication when any fixed candidate projection cannot become ready", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      fake.rejectProjectionPromotion();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
    });

    it("rolls back publication when the exact flattened PageIndex cannot become ready", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      fake.useFullTargetClosure();
      fake.rejectPageIndexPromotion();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: fullPublicationMembers(),
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "projection_set_publication_heads" &&
            (call.input.operation === "insert" || call.input.operation === "update"),
        ),
      ).toBe(false);
    });

    it("rolls back publication when the exact document asset revision cannot become parsed", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 10,
      });
      await repository.createCandidate(candidate());
      fake.rejectAssetRevision();

      await expect(
        repository.publishDocumentCompilationCandidate({
          ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
          attemptFence: publicationFence(setIdA),
          expectedHeadRevision: 0,
          expectedMembers: [publicationMember()],
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
      await expect(
        repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
      ).resolves.toMatchObject({ status: "candidate" });
      await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
    });

    it("paginates GC candidates with tenant isolation and enforces the configured bound", async () => {
      const fake = createFakePublicationDatabase(dialect);
      const repository = createDatabaseProjectionSetPublicationRepository({
        database: fake.database,
        maxListLimit: 2,
      });
      for (const [fingerprint, id] of [
        [fingerprintA, setIdA],
        [fingerprintB, setIdB],
        [fingerprintC, setIdC],
      ] as const) {
        await repository.createCandidate(candidate({ fingerprint, id }));
        await repository.deactivate(transition(fingerprint, "2026-05-27T12:01:00.000Z"));
      }
      await repository.createCandidate(
        candidate({
          fingerprint: fingerprintA,
          id: otherSetId,
          knowledgeSpaceId: otherKnowledgeSpaceId,
          tenantId: otherTenantId,
        }),
      );
      await repository.deactivate({
        fingerprint: fingerprintA,
        knowledgeSpaceId: otherKnowledgeSpaceId,
        tenantId: otherTenantId,
        updatedAt: "2026-05-27T12:01:00.000Z",
      });

      await expect(
        repository.listGcCandidates({
          knowledgeSpaceId,
          limit: 3,
          olderThan: "2026-05-28T00:00:00.000Z",
          tenantId,
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationListLimitExceededError);
      const first = await repository.listGcCandidates({
        knowledgeSpaceId,
        limit: 2,
        olderThan: "2026-05-28T00:00:00.000Z",
        tenantId,
      });
      expect(first.items.map((item) => item.fingerprint)).toEqual([fingerprintA, fingerprintB]);
      expect(first.nextCursor).toBe(fingerprintB);
      const second = await repository.listGcCandidates({
        cursor: first.nextCursor,
        knowledgeSpaceId,
        limit: 2,
        olderThan: "2026-05-28T00:00:00.000Z",
        tenantId,
      });
      expect(second.items.map((item) => item.fingerprint)).toEqual([fingerprintC]);
    });
  },
);

it("fails closed when the database cannot provide a transaction", async () => {
  const fake = createFakePublicationDatabase("postgres");
  const database = createSchemaDatabaseAdapter({
    executor: (input) => fake.database.execute(input),
    kind: "postgres",
  });
  const repository = createDatabaseProjectionSetPublicationRepository({
    database,
    maxListLimit: 10,
  });
  await repository.createCandidate(candidate());

  await expect(
    repository.publish({
      ...transition(fingerprintA, "2026-05-27T12:01:00.000Z"),
      expectedHeadRevision: 0,
    }),
  ).rejects.toThrow("Database transactions are not configured for postgres");
});

function candidate(
  overrides: Partial<
    Parameters<
      ReturnType<typeof createDatabaseProjectionSetPublicationRepository>["createCandidate"]
    >[0]
  > = {},
) {
  return {
    createdAt: "2026-05-27T12:00:00.000Z",
    fingerprint: fingerprintA,
    id: setIdA,
    knowledgeSpaceId,
    metadata: { parserPolicyVersion: "parser-v1" },
    projectionVersion: 1,
    tenantId,
    ...overrides,
  };
}

function transition(fingerprint: string, updatedAt: string) {
  return { fingerprint, knowledgeSpaceId, tenantId, updatedAt };
}

function publicationFence(candidatePublicationId: string) {
  return {
    attemptId,
    candidatePublicationId,
    documentAssetId,
    documentVersion: 1,
    expectedRowVersion: 7,
    leaseToken,
    publicationGenerationId: generationId,
  };
}

function logicalPublicationFence() {
  return {
    documentId: logicalDocumentId,
    expectedActiveRevision: null,
    expectedDocumentRowVersion: 0,
    revision: 1,
  };
}

function expectNoDocumentPublicationEffects(
  calls: readonly FakePublicationDatabase["calls"][number][],
): void {
  const downstreamTables = new Set([
    "deletion_tombstones",
    "document_assets",
    "document_chunk_state_changes",
    "document_reindex_attempts",
    "document_revision_chunks",
    "document_revisions",
    "document_settings_heads",
    "document_settings_revisions",
    "index_projections",
    "knowledge_space_profile_heads",
    "knowledge_space_profile_publication_bindings",
    "logical_documents",
    "page_index_manifests",
    "projection_set_publication_heads",
    "projection_set_publication_members",
    "projection_set_publications",
  ]);
  expect(calls.filter((call) => downstreamTables.has(call.input.tableName))).toEqual([]);
}

function publicationMember() {
  return {
    componentKey: setIdC,
    componentType: "index-projection" as const,
    documentAssetId,
    generationId,
  };
}

function fullPublicationMembers(): readonly DocumentCompilationPublicationMemberSnapshot[] {
  return [
    {
      componentKey: outlineId,
      componentType: "document-outline",
      documentAssetId,
      generationId,
    },
    {
      componentKey: multimodalManifestId,
      componentType: "multimodal-manifest",
      documentAssetId,
      generationId,
    },
    {
      componentKey: knowledgePathId,
      componentType: "knowledge-path",
      documentAssetId,
      generationId,
    },
    publicationMember(),
    {
      componentKey: inheritedProjectionId,
      componentType: "index-projection",
      documentAssetId: inheritedDocumentAssetId,
      generationId: inheritedGenerationId,
    },
    {
      componentKey: graphEntityAId,
      componentType: "graph-entity",
      documentAssetId,
      generationId,
    },
    {
      componentKey: graphEntityBId,
      componentType: "graph-entity",
      documentAssetId: inheritedDocumentAssetId,
      generationId: inheritedGenerationId,
    },
    {
      componentKey: graphRelationId,
      componentType: "graph-relation",
      documentAssetId,
      generationId,
    },
  ];
}

function createFakePublicationDatabase(dialect: Dialect): FakePublicationDatabase {
  const publications = new Map<string, PublicationRow>();
  const heads = new Map<string, HeadRow>();
  const profileBindings = new Map<string, PublicationRow>();
  const calls: FakePublicationDatabase["calls"] = [];
  const ownedSpaces = new Map([
    [knowledgeSpaceId, tenantId],
    [otherKnowledgeSpaceId, otherTenantId],
  ]);
  let firstHeadRacePublicationId: string | undefined;
  let committedFirstHeadRace:
    | { readonly head: HeadRow; readonly publicationId: string; readonly updatedAt: string }
    | undefined;
  let attemptFenceAccepted = true;
  let profileFenceAccepted = true;
  let embeddingProfileFence = false;
  let memberSnapshotAccepted = true;
  let memberSnapshot: readonly DocumentCompilationPublicationMemberSnapshot[] = [
    publicationMember(),
  ];
  let targetClosureAccepted = true;
  let candidateProjectionReady = false;
  let candidatePageIndexReady = false;
  let pageIndexClosureAccepted = true;
  let pageIndexPromotionAccepted = true;
  let projectionPromotionAccepted = true;
  let assetRevisionAccepted = true;
  let rejectedNodeProjectionClosure: "dense" | "fts" | "orphan" | undefined;
  let injectTombstoneAfterAttemptFence = false;
  let deletionTombstoneVisible = false;
  let tombstonedMemberDocumentAssetId: string | undefined;
  let spaceLifecycleState = "active";
  let logicalDocumentHierarchy = false;
  let attemptPermissionProvenance: "complete" | "missing" | "partial" = "complete";
  let permissionAccessChannel: "interactive" | "service_api" = "interactive";
  let permissionVisibility: "all_members" | "partial_members" = "all_members";
  let publicationMemberActive = true;
  let publicationPermissionRevisionCurrent = true;
  let publicationPartialMemberPresent = true;
  let publicationApiKeyState: "active" | "expired" | "revoked" | undefined;

  const execute = async (
    input: DatabaseExecuteInput,
    lane: "outside" | "transaction",
  ): Promise<DatabaseExecuteResult> => {
    calls.push({ input: { ...input, params: [...input.params] }, lane });

    if (input.tableName === "knowledge_spaces") {
      const owner = ownedSpaces.get(String(input.params[1]));
      const row =
        owner === input.params[0]
          ? {
              deletion_job_id: spaceLifecycleState === "active" ? null : "deletion-job-1",
              id: input.params[1],
              lifecycle_state: spaceLifecycleState,
            }
          : null;

      return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.tableName === "document_compilation_attempts") {
      if (injectTombstoneAfterAttemptFence) {
        deletionTombstoneVisible = true;
        injectTombstoneAfterAttemptFence = false;
      }
      const provenance =
        attemptPermissionProvenance === "missing"
          ? {
              access_channel: null,
              permission_snapshot_id: null,
              permission_snapshot_revision: null,
              requested_by_subject_id: null,
            }
          : attemptPermissionProvenance === "partial"
            ? {
                access_channel: null,
                permission_snapshot_id: permissionSnapshotId,
                permission_snapshot_revision: null,
                requested_by_subject_id: requestedBySubjectId,
              }
            : {
                access_channel: permissionAccessChannel,
                permission_snapshot_id: permissionSnapshotId,
                permission_snapshot_revision: permissionSnapshotRevision,
                requested_by_subject_id: requestedBySubjectId,
              };
      return attemptFenceAccepted
        ? { rows: [{ id: input.params[0], ...provenance }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }

    const permissionSnapshotRow = () => ({
      access_channel: permissionAccessChannel,
      access_policy_revision: 5,
      api_access_revision: 6,
      api_key_expires_at:
        permissionAccessChannel === "service_api"
          ? publicationApiKeyState === "expired"
            ? "2026-05-26T00:00:00.000Z"
            : "2026-06-30T00:00:00.000Z"
          : null,
      api_key_id: permissionAccessChannel === "service_api" ? permissionApiKeyId : null,
      api_key_revision: permissionAccessChannel === "service_api" ? 2 : null,
      created_at: "2026-05-01T00:00:00.000Z",
      expires_at: "2026-06-30T00:00:00.000Z",
      id: permissionSnapshotId,
      knowledge_space_id: knowledgeSpaceId,
      member_revision: 4,
      permission_scopes: JSON.stringify(["knowledge:write"]),
      revision: permissionSnapshotRevision,
      revoked_at: null,
      role: "editor",
      status: "active",
      subject_id: requestedBySubjectId,
      tenant_id: tenantId,
      updated_at: "2026-05-01T00:00:00.000Z",
      visibility: permissionVisibility,
    });

    if (input.tableName === "knowledge_space_permission_snapshots") {
      const finalRevalidation = input.sql.includes(" INNER JOIN ");
      const permissionCurrent =
        publicationMemberActive &&
        publicationPermissionRevisionCurrent &&
        (permissionVisibility !== "partial_members" || publicationPartialMemberPresent) &&
        (permissionAccessChannel !== "service_api" || publicationApiKeyState === "active");
      return finalRevalidation && !permissionCurrent
        ? { rows: [], rowsAffected: 0 }
        : { rows: [permissionSnapshotRow()], rowsAffected: 1 };
    }

    if (input.tableName === "knowledge_space_members") {
      return publicationMemberActive
        ? { rows: [{ id: permissionMemberId }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "knowledge_space_access_policies") {
      return { rows: [{ id: permissionPolicyId }], rowsAffected: 1 };
    }

    if (input.tableName === "knowledge_space_api_access") {
      return { rows: [{ id: permissionApiAccessId }], rowsAffected: 1 };
    }

    if (input.tableName === "knowledge_space_api_keys") {
      return { rows: [{ id: permissionApiKeyId }], rowsAffected: 1 };
    }

    if (input.tableName === "document_revisions") {
      if (logicalDocumentHierarchy) {
        if (input.operation === "update") return { rows: [], rowsAffected: 1 };
        return {
          rows: [
            {
              compilation_attempt_id: attemptId,
              document_id: logicalDocumentId,
              expected_active_revision: null,
              expected_document_row_version: 0,
              revision: 1,
              state: "candidate",
            },
          ],
          rowsAffected: 1,
        };
      }
      // Most publication repository tests exercise legacy asset-only compilation. The production
      // repository still probes the exact attempt for an optional logical-document candidate; an
      // empty result is the valid legacy/compatibility case.
      return { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "logical_documents") {
      return logicalDocumentHierarchy
        ? input.operation === "update"
          ? { rows: [], rowsAffected: 1 }
          : { rows: [{ active_revision: null, row_version: 0 }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "document_revision_chunks") {
      return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
    }

    if (
      input.tableName === "document_reindex_attempts" ||
      input.tableName === "document_chunk_state_changes"
    ) {
      return { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "knowledge_space_profile_heads") {
      if (input.sql.includes("document_compilation_attempts")) {
        return profileFenceAccepted
          ? {
              rows: [
                {
                  embedding_profile_kind: null,
                  embedding_profile_revision: embeddingProfileFence ? 5 : null,
                  embedding_profile_revision_id: embeddingProfileFence
                    ? embeddingProfileRevisionId
                    : null,
                  embedding_profile_snapshot_digest: embeddingProfileFence
                    ? embeddingProfileDigest
                    : null,
                  retrieval_profile_revision: 7,
                  retrieval_profile_revision_id: retrievalProfileRevisionId,
                  retrieval_profile_snapshot_digest: retrievalProfileDigest,
                  ...(embeddingProfileFence ? { embedding_profile_kind: "embedding" } : {}),
                  id: attemptId,
                },
              ],
              rowsAffected: 1,
            }
          : { rows: [], rowsAffected: 0 };
      }
      return embeddingProfileFence
        ? {
            rows: [{ id: embeddingProfileRevisionId, vector_space_id: embeddingVectorSpaceId }],
            rowsAffected: 1,
          }
        : { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "knowledge_space_profile_publication_bindings") {
      if (input.operation === "insert") {
        const row = profileBindingRowFromInsert(input.params);
        const publicationId = String(row.publication_id);
        if (profileBindings.has(publicationId)) {
          return { rows: [], rowsAffected: 0 };
        }
        profileBindings.set(publicationId, row);
        return { rows: [], rowsAffected: 1 };
      }
      if (input.operation === "delete") {
        const row = profileBindings.get(String(input.params[0]));
        if (
          !row ||
          row.tenant_id !== input.params[1] ||
          row.knowledge_space_id !== input.params[2]
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        profileBindings.delete(String(row.publication_id));
        return { rows: [], rowsAffected: 1 };
      }
      const row = profileBindings.get(String(input.params[2]));
      const matches =
        row && row.tenant_id === input.params[0] && row.knowledge_space_id === input.params[1];
      return { rows: matches ? [{ ...row }] : [], rowsAffected: matches ? 1 : 0 };
    }

    if (input.tableName === "deletion_tombstones") {
      const memberTombstoneVisible =
        tombstonedMemberDocumentAssetId !== undefined &&
        memberSnapshot.some((member) => member.documentAssetId === tombstonedMemberDocumentAssetId);
      return deletionTombstoneVisible || memberTombstoneVisible
        ? { rows: [{ id: "tombstone-1" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "projection_set_publication_members") {
      const rows = memberSnapshot.map((member, index) => ({
        component_key: !memberSnapshotAccepted && index === 0 ? otherSetId : member.componentKey,
        component_type: member.componentType,
        document_asset_id: member.documentAssetId,
        generation_id: member.generationId,
      }));
      return {
        rows,
        rowsAffected: rows.length,
      };
    }

    if (input.tableName === "knowledge_space_manifests") {
      return {
        rows: [
          {
            metadata: JSON.stringify({
              __knowledgeFsEmbeddingProfile: {
                dimension: 3,
                model: "embed-v1",
                pluginId: "plugin-daemon",
                provider: "provider",
                revision: 1,
                vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
              },
            }),
          },
        ],
        rowsAffected: 1,
      };
    }

    const closureRows = (
      componentType: DocumentCompilationPublicationMemberSnapshot["componentType"],
      additionalColumns:
        | Record<string, unknown>
        | ((member: DocumentCompilationPublicationMemberSnapshot) => Record<string, unknown>) = {},
    ) => {
      if (!targetClosureAccepted && componentType === "document-outline") {
        return { rows: [], rowsAffected: 0 };
      }
      const rows = memberSnapshot
        .filter((member) => member.componentType === componentType)
        .map((member) => ({
          member_component_key: member.componentKey,
          member_document_asset_id: member.documentAssetId,
          member_generation_id: member.generationId,
          ...(typeof additionalColumns === "function"
            ? additionalColumns(member)
            : additionalColumns),
        }));
      return { rows, rowsAffected: rows.length };
    };

    if (input.tableName === "document_outlines") {
      return closureRows("document-outline");
    }

    if (input.tableName === "document_multimodal_manifests") {
      return closureRows("multimodal-manifest");
    }

    if (input.tableName === "knowledge_paths") {
      return closureRows("knowledge-path");
    }

    if (input.tableName === "index_projections") {
      if (input.operation === "update") {
        if (projectionPromotionAccepted) {
          candidateProjectionReady = true;
        }
        return { rows: [], rowsAffected: projectionPromotionAccepted ? 1 : 0 };
      }

      if (input.sql.includes("member_component_key")) {
        return closureRows("index-projection", (member) => ({
          node_id:
            member.componentKey === inheritedProjectionId ? inheritedSourceNodeId : sourceNodeId,
        }));
      }

      return candidateProjectionReady
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ component_key: setIdC }], rowsAffected: 1 };
    }

    if (input.tableName === "page_index_manifests") {
      if (input.operation === "update") {
        if (pageIndexPromotionAccepted) {
          candidatePageIndexReady = true;
        }
        return { rows: [], rowsAffected: pageIndexPromotionAccepted ? 1 : 0 };
      }
      return candidatePageIndexReady && pageIndexClosureAccepted
        ? { rows: [], rowsAffected: 0 }
        : memberSnapshot.some((member) => member.componentType === "document-outline")
          ? { rows: [{ component_key: outlineId }], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "graph_entities") {
      return closureRows("graph-entity", (member) => ({
        source_node_ids: JSON.stringify([
          member.componentKey === graphEntityBId ? inheritedSourceNodeId : sourceNodeId,
        ]),
      }));
    }

    if (input.tableName === "graph_relations") {
      return closureRows("graph-relation", {
        object_entity_id: graphEntityBId,
        source_node_ids: JSON.stringify([sourceNodeId]),
        subject_entity_id: graphEntityAId,
      });
    }

    if (input.tableName === "knowledge_nodes") {
      if (input.sql.includes("candidate_has_fts")) {
        const inherited = input.params[3] === inheritedDocumentAssetId;
        const rows = [
          {
            candidate_has_dense:
              rejectedNodeProjectionClosure === "dense" ||
              rejectedNodeProjectionClosure === "orphan"
                ? 0
                : 1,
            candidate_has_fts:
              rejectedNodeProjectionClosure === "fts" || rejectedNodeProjectionClosure === "orphan"
                ? 0
                : 1,
            id: inherited ? inheritedSourceNodeId : sourceNodeId,
          },
        ];
        return { rows, rowsAffected: rows.length };
      }
      if (
        logicalDocumentHierarchy &&
        input.params.length === 3 &&
        input.params[1] === documentAssetId &&
        input.params[2] === generationId
      ) {
        const rows = [
          {
            end_offset: 10,
            id: leafChunkNodeId,
            kind: "chunk",
            metadata: {},
            source_location: { endOffset: 10, startOffset: 0 },
            start_offset: 0,
            text: "leaf chunk",
          },
          {
            end_offset: 10,
            id: sectionSummaryNodeId,
            kind: "summary",
            metadata: { childNodeIds: [leafChunkNodeId], summaryLevel: "section" },
            source_location: { endOffset: 10, startOffset: 0 },
            start_offset: 0,
            text: "section summary",
          },
          {
            end_offset: 10,
            id: documentSummaryNodeId,
            kind: "summary",
            metadata: { childNodeIds: [sectionSummaryNodeId], summaryLevel: "document" },
            source_location: { endOffset: 10, startOffset: 0 },
            start_offset: 0,
            text: "document summary",
          },
        ];
        return { rows, rowsAffected: rows.length };
      }
      const rows = input.params.slice(1).map((rawNodeId) => {
        const id = String(rawNodeId);
        const inherited = id === inheritedSourceNodeId;
        return {
          document_asset_id: inherited ? inheritedDocumentAssetId : documentAssetId,
          id,
          publication_generation_id: inherited ? inheritedGenerationId : generationId,
        };
      });
      return {
        rows,
        rowsAffected: rows.length,
      };
    }

    if (input.tableName === "document_assets") {
      return { rows: [], rowsAffected: assetRevisionAccepted ? 1 : 0 };
    }

    if (input.tableName === "projection_set_publications") {
      if (input.operation === "insert") {
        const row = publicationRowFromInsert(input.params);
        const duplicate = Array.from(publications.values()).some(
          (candidate) =>
            candidate.tenant_id === row.tenant_id &&
            candidate.knowledge_space_id === row.knowledge_space_id &&
            candidate.fingerprint === row.fingerprint,
        );
        if (duplicate) {
          return { rows: [], rowsAffected: 0 };
        }

        publications.set(String(row.id), row);
        return {
          rows: dialect === "postgres" ? [{ ...row }] : [],
          rowsAffected: 1,
        };
      }

      if (input.operation === "update") {
        const row = publications.get(String(input.params[3]));
        if (
          !row ||
          row.tenant_id !== input.params[4] ||
          row.knowledge_space_id !== input.params[5] ||
          row.status !== input.params[6]
        ) {
          return { rows: [], rowsAffected: 0 };
        }

        row.status = input.params[0];
        row.superseded_by_fingerprint = input.params[1];
        row.updated_at = input.params[2];
        return {
          rows: dialect === "postgres" ? [{ ...row }] : [],
          rowsAffected: 1,
        };
      }

      if (input.operation === "delete") {
        const row = publications.get(String(input.params[0]));
        if (
          !row ||
          row.tenant_id !== input.params[1] ||
          row.knowledge_space_id !== input.params[2]
        ) {
          return { rows: [], rowsAffected: 0 };
        }

        publications.delete(String(row.id));
        return { rows: [], rowsAffected: 1 };
      }

      if (input.sql.includes("ORDER BY")) {
        const tenant = input.params[0];
        const space = input.params[1];
        const olderThan = String(input.params[2]);
        const hasCursor = input.params.length === 5;
        const cursor = hasCursor ? String(input.params[3]) : undefined;
        const limit = Number(input.params.at(-1));
        const rows = Array.from(publications.values())
          .filter((row) => row.tenant_id === tenant && row.knowledge_space_id === space)
          .filter((row) => row.status === "inactive" || row.status === "superseded")
          .filter((row) => String(row.updated_at) < olderThan)
          .filter((row) => (cursor ? String(row.fingerprint) > cursor : true))
          .sort((left, right) => String(left.fingerprint).localeCompare(String(right.fingerprint)))
          .slice(0, limit)
          .map((row) => ({ ...row }));

        return { rows, rowsAffected: rows.length };
      }

      const row = Array.from(publications.values()).find(
        (candidate) =>
          candidate.tenant_id === input.params[0] &&
          candidate.knowledge_space_id === input.params[1] &&
          candidate.fingerprint === input.params[2],
      );
      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.tableName === "projection_set_publication_heads") {
      if (input.operation === "insert") {
        const key = headKey(String(input.params[1]), String(input.params[2]));
        if (firstHeadRacePublicationId) {
          const racePublication = publications.get(firstHeadRacePublicationId);
          if (!racePublication) {
            throw new Error("Fake race publication does not exist");
          }
          racePublication.status = "published";
          const racedHead = {
            created_at: String(input.params[5]),
            head_revision: 1,
            id: String(input.params[0]),
            knowledge_space_id: String(input.params[2]),
            publication_id: firstHeadRacePublicationId,
            tenant_id: String(input.params[1]),
            updated_at: String(input.params[6]),
          } satisfies HeadRow;
          heads.set(key, racedHead);
          committedFirstHeadRace = {
            head: { ...racedHead },
            publicationId: firstHeadRacePublicationId,
            updatedAt: String(input.params[6]),
          };
          firstHeadRacePublicationId = undefined;
          return { rows: [], rowsAffected: 0 };
        }
        if (heads.has(key)) {
          return { rows: [], rowsAffected: 0 };
        }

        const row: HeadRow = {
          created_at: String(input.params[5]),
          head_revision: Number(input.params[4]),
          id: String(input.params[0]),
          knowledge_space_id: String(input.params[2]),
          publication_id: String(input.params[3]),
          tenant_id: String(input.params[1]),
          updated_at: String(input.params[6]),
        };
        heads.set(key, row);
        return {
          rows: dialect === "postgres" ? [{ head_revision: row.head_revision }] : [],
          rowsAffected: 1,
        };
      }

      if (input.operation === "update") {
        const key = headKey(String(input.params[3]), String(input.params[4]));
        const row = heads.get(key);
        if (!row || row.head_revision !== input.params[5]) {
          return { rows: [], rowsAffected: 0 };
        }

        row.publication_id = String(input.params[0]);
        row.head_revision = Number(input.params[1]);
        row.updated_at = String(input.params[2]);
        return {
          rows: dialect === "postgres" ? [{ head_revision: row.head_revision }] : [],
          rowsAffected: 1,
        };
      }

      const head = heads.get(headKey(String(input.params[0]), String(input.params[1])));
      const publication = head ? publications.get(head.publication_id) : undefined;
      const row =
        head && publication ? { ...publication, head_revision: head.head_revision } : null;
      return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
    }

    throw new Error(`Unexpected fake publication SQL table=${input.tableName}`);
  };

  const outsideExecutor = (input: DatabaseExecuteInput) => execute(input, "outside");
  const transaction = async <T>(
    callback: (executor: {
      execute(input: DatabaseExecuteInput): Promise<DatabaseExecuteResult>;
    }) => Promise<T>,
  ): Promise<T> => {
    const publicationSnapshot = cloneRows(publications);
    const headSnapshot = cloneRows(heads);
    const profileBindingSnapshot = cloneRows(profileBindings);
    const projectionReadySnapshot = candidateProjectionReady;
    const pageIndexReadySnapshot = candidatePageIndexReady;
    try {
      return await callback({ execute: (input) => execute(input, "transaction") });
    } catch (error) {
      restoreRows(publications, publicationSnapshot);
      restoreRows(heads, headSnapshot);
      restoreRows(profileBindings, profileBindingSnapshot);
      candidateProjectionReady = projectionReadySnapshot;
      candidatePageIndexReady = pageIndexReadySnapshot;
      if (committedFirstHeadRace) {
        const winner = publications.get(committedFirstHeadRace.publicationId);
        if (!winner) {
          throw new Error("Fake committed race publication disappeared during rollback");
        }

        winner.status = "published";
        winner.superseded_by_fingerprint = null;
        winner.updated_at = committedFirstHeadRace.updatedAt;
        heads.set(
          headKey(
            committedFirstHeadRace.head.tenant_id,
            committedFirstHeadRace.head.knowledge_space_id,
          ),
          { ...committedFirstHeadRace.head },
        );
        committedFirstHeadRace = undefined;
      }
      throw error;
    }
  };

  return {
    advancePublicationPermissionRevision: () => {
      publicationPermissionRevisionCurrent = false;
    },
    calls,
    clearAttemptPermissionProvenance: (kind) => {
      attemptPermissionProvenance = kind;
    },
    corruptReadyPageIndexClosure: () => {
      pageIndexClosureAccepted = false;
    },
    database: createSchemaDatabaseAdapter({
      executor: outsideExecutor,
      kind: dialect,
      transaction,
    }),
    existingProfileBinding: (kind) => {
      profileBindings.set(setIdA, {
        activated_at: "2026-05-27T12:00:00.000Z",
        binding_reason: "content-publication",
        changed_kind: "content",
        created_at: "2026-05-27T12:00:00.000Z",
        embedding_profile_kind: embeddingProfileFence ? "embedding" : null,
        embedding_profile_revision: embeddingProfileFence ? 5 : null,
        embedding_profile_revision_id: embeddingProfileFence ? embeddingProfileRevisionId : null,
        embedding_profile_snapshot_digest: embeddingProfileFence ? embeddingProfileDigest : null,
        id: setIdA,
        knowledge_space_id: knowledgeSpaceId,
        publication_fingerprint: fingerprintA,
        publication_id: setIdA,
        retrieval_profile_kind: "retrieval",
        retrieval_profile_revision: 7,
        retrieval_profile_revision_id: retrievalProfileRevisionId,
        retrieval_profile_snapshot_digest:
          kind === "exact" ? retrievalProfileDigest : "0".repeat(64),
        tenant_id: tenantId,
        vector_space_id: embeddingProfileFence ? embeddingVectorSpaceId : null,
      });
    },
    injectFirstHeadRace: (publicationId) => {
      firstHeadRacePublicationId = publicationId;
    },
    injectDeletionTombstoneAfterAttemptFence: () => {
      injectTombstoneAfterAttemptFence = true;
    },
    injectMemberDocumentTombstone: (documentAssetId) => {
      tombstonedMemberDocumentAssetId = documentAssetId;
    },
    markIndexProjectionReady: () => {
      candidateProjectionReady = true;
    },
    profileBindingCount: () => profileBindings.size,
    removePublicationPartialMember: () => {
      publicationPartialMemberPresent = false;
    },
    revokePublicationMember: () => {
      publicationMemberActive = false;
    },
    setPublicationApiKeyState: (state) => {
      permissionAccessChannel = "service_api";
      publicationApiKeyState = state;
    },
    markSpaceDeleting: () => {
      spaceLifecycleState = "deleting";
    },
    removeReadyPageIndex: () => {
      candidatePageIndexReady = false;
    },
    rejectAttemptFence: () => {
      attemptFenceAccepted = false;
    },
    rejectTargetClosure: () => {
      targetClosureAccepted = false;
    },
    rejectMemberSnapshot: () => {
      memberSnapshotAccepted = false;
    },
    rejectProjectionPromotion: () => {
      projectionPromotionAccepted = false;
    },
    rejectPageIndexPromotion: () => {
      pageIndexPromotionAccepted = false;
    },
    rejectProfileFence: () => {
      profileFenceAccepted = false;
    },
    rejectAssetRevision: () => {
      assetRevisionAccepted = false;
    },
    rejectNodeProjectionClosure: (kind) => {
      rejectedNodeProjectionClosure = kind;
    },
    useFullTargetClosure: () => {
      memberSnapshot = fullPublicationMembers();
    },
    useLogicalDocumentHierarchy: () => {
      logicalDocumentHierarchy = true;
    },
    useEmbeddingProfileFence: () => {
      embeddingProfileFence = true;
    },
    usePartialMemberPermission: () => {
      permissionVisibility = "partial_members";
    },
  };
}

function publicationRowFromInsert(params: readonly unknown[]): PublicationRow {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "fingerprint",
    "projection_version",
    "status",
    "superseded_by_fingerprint",
    "metadata",
    "created_at",
    "updated_at",
  ];
  const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
  row.metadata = JSON.parse(String(row.metadata));

  return row;
}

function profileBindingRowFromInsert(params: readonly unknown[]): PublicationRow {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "changed_kind",
    "binding_reason",
    "embedding_profile_kind",
    "embedding_profile_revision_id",
    "embedding_profile_revision",
    "embedding_profile_snapshot_digest",
    "retrieval_profile_kind",
    "retrieval_profile_revision_id",
    "retrieval_profile_revision",
    "retrieval_profile_snapshot_digest",
    "vector_space_id",
    "publication_id",
    "publication_fingerprint",
    "created_at",
    "activated_at",
  ];
  return Object.fromEntries(columns.map((column, index) => [column, params[index]]));
}

function headKey(tenant: string, space: string): string {
  return `${tenant}:${space}`;
}

function cloneRows<T extends object>(rows: Map<string, T>): Map<string, T> {
  return new Map(
    Array.from(rows.entries()).map(([key, row]) => [key, JSON.parse(JSON.stringify(row)) as T]),
  );
}

function restoreRows<T extends object>(target: Map<string, T>, snapshot: Map<string, T>): void {
  target.clear();
  for (const [key, row] of snapshot) {
    target.set(key, row);
  }
}
