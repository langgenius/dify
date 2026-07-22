import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DocumentCandidateAdmissionError,
  assertDatabaseDocumentCandidateAdmission,
} from "./document-candidate-admission";
import { createDatabaseDocumentChunkRepository } from "./document-chunk-repository";
import { createDatabaseDocumentSettingsRepository } from "./document-settings-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const chunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31";

describe("database document candidate admission", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    for (const failure of ["revoked", "deleting", "partial-member"] as const) {
      it(`leaves no settings candidate after ${failure} admission failure (${dialect})`, async () => {
        const fixture = admissionDatabase(dialect, failure);
        const repository = createDatabaseDocumentSettingsRepository({
          database: fixture.database,
        });

        await expect(
          repository.requestChange({
            compilationAttemptId: attemptId,
            createdBySubjectId: "editor-a",
            documentId,
            documentRevision: 1,
            expectedSettingsHeadRevision: null,
            knowledgeSpaceId,
            now: "2026-07-14T12:00:00.000Z",
            settings: {
              chunkOverlap: 64,
              chunkSize: 512,
              enableGraph: true,
              enablePageIndex: true,
            },
            tenantId,
          }),
        ).rejects.toThrow("Document settings candidate admission denied");
        expect(candidateWrites(fixture.calls)).toEqual([]);
      });

      it(`leaves no chunk candidate after ${failure} admission failure (${dialect})`, async () => {
        const fixture = admissionDatabase(dialect, failure);
        const repository = createDatabaseDocumentChunkRepository({
          database: fixture.database,
          maxBatchSize: 10,
          maxListLimit: 100,
        });

        await expect(
          repository.stageStateChange({
            chunkId,
            compilationAttemptId: attemptId,
            documentId,
            documentRevision: 1,
            enabled: false,
            knowledgeSpaceId,
            now: "2026-07-14T12:00:00.000Z",
            requestedBySubjectId: "editor-a",
            tenantId,
          }),
        ).rejects.toThrow("Document chunk candidate admission denied");
        expect(candidateWrites(fixture.calls)).toEqual([]);
      });
    }

    it(`fails closed for missing/partial attempt provenance and admits only explicit trusted internal attempts (${dialect})`, async () => {
      const partial = admissionDatabase(dialect, "partial-provenance");
      await expect(
        assertDatabaseDocumentCandidateAdmission({
          admission: admissionInput(),
          database: partial.database,
          executor: partial.database,
        }),
      ).rejects.toBeInstanceOf(DocumentCandidateAdmissionError);

      const missing = admissionDatabase(dialect, "missing-provenance");
      await expect(
        assertDatabaseDocumentCandidateAdmission({
          admission: admissionInput(),
          database: missing.database,
          executor: missing.database,
        }),
      ).rejects.toBeInstanceOf(DocumentCandidateAdmissionError);
      await expect(
        assertDatabaseDocumentCandidateAdmission({
          admission: { ...admissionInput(), trustedInternal: true },
          database: missing.database,
          executor: missing.database,
        }),
      ).resolves.toBeNull();
    });

    it(`locks the space deletion fence before the compilation attempt (${dialect})`, async () => {
      const fixture = admissionDatabase(dialect, "missing-provenance");
      await expect(
        assertDatabaseDocumentCandidateAdmission({
          admission: { ...admissionInput(), trustedInternal: true },
          database: fixture.database,
          executor: fixture.database,
        }),
      ).resolves.toBeNull();

      const lockingReads = fixture.calls.filter(
        (call) => call.operation === "select" && call.sql.includes("FOR UPDATE"),
      );
      expect(lockingReads.map((call) => call.tableName).slice(0, 3)).toEqual([
        "knowledge_spaces",
        "deletion_jobs",
        "document_compilation_attempts",
      ]);
    });
  }
});

function admissionInput() {
  return {
    compilationAttemptId: attemptId,
    documentId,
    documentRevision: 1,
    knowledgeSpaceId,
    now: "2026-07-14T12:00:00.000Z",
    requestedBySubjectId: "editor-a",
    tenantId,
  };
}

function candidateWrites(calls: readonly DatabaseExecuteInput[]) {
  return calls.filter(
    (call) =>
      call.operation === "insert" &&
      [
        "document_settings_revisions",
        "document_reindex_attempts",
        "document_chunk_state_changes",
      ].includes(call.tableName),
  );
}

function admissionDatabase(
  dialect: "postgres" | "tidb",
  failure: "deleting" | "missing-provenance" | "partial-member" | "partial-provenance" | "revoked",
) {
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "document_compilation_attempts") {
      const missing = failure === "missing-provenance";
      return {
        rows: [
          {
            access_channel: missing || failure === "partial-provenance" ? null : "interactive",
            document_asset_id: assetId,
            document_version: 1,
            permission_snapshot_id: missing ? null : "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
            permission_snapshot_revision: missing ? null : 1,
            requested_by_subject_id: missing ? null : "editor-a",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [
          {
            deletion_job_id: failure === "deleting" ? "deletion-1" : null,
            id: knowledgeSpaceId,
            lifecycle_state: failure === "deleting" ? "deleting" : "active",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (input.tableName === "document_assets") {
      return {
        rows: [
          {
            metadata: {
              permissionScope:
                failure === "partial-member"
                  ? [`knowledge-space:${knowledgeSpaceId}:member:another-editor`]
                  : actorPermissionScopes(),
            },
            source_id: null,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "logical_documents") {
      return { rows: [{ id: documentId }], rowsAffected: 0 };
    }
    if (input.tableName === "document_revisions") {
      return { rows: [{ revision: 1 }], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return {
        rows: failure === "revoked" ? [] : [permissionSnapshotRow()],
        rowsAffected: 0,
      };
    }
    if (
      [
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
      ].includes(input.tableName)
    ) {
      return { rows: [{ id: `${input.tableName}-row` }], rowsAffected: 0 };
    }
    if (input.tableName === "document_revision_chunks") {
      return {
        rows: [
          {
            created_at: "2026-07-14T11:00:00.000Z",
            document_id: documentId,
            document_revision: 1,
            effective_enabled: true,
            id: chunkId,
            knowledge_space_id: knowledgeSpaceId,
            ordinal: 0,
            parent_chunk_id: null,
            system_metadata: {},
            tenant_id: tenantId,
            text: "candidate",
            token_count: 1,
            user_metadata: {},
          },
        ],
        rowsAffected: 0,
      };
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function actorPermissionScopes(): readonly string[] {
  return [
    `knowledge-space:${knowledgeSpaceId}`,
    `knowledge-space:${knowledgeSpaceId}:member:editor-a`,
    `knowledge-space:${knowledgeSpaceId}:role:editor`,
    `knowledge-space:${knowledgeSpaceId}:visibility:partial_members:editor-a`,
    `tenant:${tenantId}`,
  ].sort();
}

function permissionSnapshotRow() {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-07-14T11:00:00.000Z",
    expires_at: "2026-07-15T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: actorPermissionScopes(),
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-a",
    tenant_id: tenantId,
    updated_at: "2026-07-14T11:00:00.000Z",
    visibility: "partial_members",
  };
}
