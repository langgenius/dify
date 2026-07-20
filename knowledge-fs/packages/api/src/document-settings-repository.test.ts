import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentSettingsRepository,
  createInMemoryDocumentSettingsRepository,
  parseDocumentIndexSettings,
} from "./document-settings-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const settings = {
  chunkOverlap: 64,
  chunkSize: 512,
  enableGraph: true,
  enablePageIndex: true,
  language: "en-US",
};

describe("document settings repository", () => {
  it("advances the settings head only after success, preserves it on failure, and retries the same candidate", async () => {
    let nextAttempt = 1;
    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => `settings-attempt-${nextAttempt++}`,
      isActiveDocumentRevision: ({ revision }) => revision === 1,
      maxAttempts: 10,
    });
    const scope = { documentId, knowledgeSpaceId, tenantId };
    const first = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-14T12:00:00.000Z",
      settings,
    });
    await expect(repository.getHead(scope)).resolves.toBeNull();
    const completedFirst = await repository.complete({
      ...scope,
      attemptId: first.attempt.id,
      candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
      expectedAttemptRowVersion: 0,
      now: "2026-07-14T12:01:00.000Z",
    });
    expect(completedFirst).toMatchObject({
      attempt: { state: "succeeded" },
      head: { activeRevision: 1, profile: { state: "active" } },
    });

    await expect(
      repository.requestChange({
        ...scope,
        compilationAttemptId: "stale-compilation",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-14T12:02:00.000Z",
        settings,
      }),
    ).rejects.toThrow("Logical document CAS conflict");

    const second = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-2",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: 1,
      now: "2026-07-14T12:03:00.000Z",
      settings: { ...settings, enableGraph: false },
    });
    const failed = await repository.fail({
      ...scope,
      attemptId: second.attempt.id,
      errorCode: "SMOKE_EVAL_FAILED",
      errorMessage: "candidate rejected",
      expectedRowVersion: 0,
      now: "2026-07-14T12:04:00.000Z",
    });
    expect(failed).toMatchObject({ rowVersion: 1, state: "failed" });
    await expect(repository.getHead(scope)).resolves.toMatchObject({ activeRevision: 1 });

    const retried = await repository.retry({
      ...scope,
      attemptId: second.attempt.id,
      expectedRowVersion: failed.rowVersion,
      now: "2026-07-14T12:05:00.000Z",
    });
    expect(retried).toMatchObject({ rowVersion: 2, state: "running" });
    await expect(
      repository.complete({
        ...scope,
        attemptId: second.attempt.id,
        candidateFingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
        expectedAttemptRowVersion: retried.rowVersion,
        now: "2026-07-14T12:06:00.000Z",
      }),
    ).resolves.toMatchObject({
      attempt: { state: "succeeded" },
      head: { activeRevision: 2, profile: { settings: { enableGraph: false } } },
    });
  });

  it("rejects unknown or inconsistent index settings before persistence", () => {
    expect(() => parseDocumentIndexSettings({ ...settings, hidden: true })).toThrow(
      "Unknown document setting hidden",
    );
    expect(() => parseDocumentIndexSettings({ ...settings, chunkOverlap: 512 })).toThrow(
      "chunkOverlap must be non-negative and less than chunkSize",
    );
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`completes candidate, head, and attempt with explicit CAS in one transaction (${dialect})`, async () => {
      const fake = completionDatabase(dialect);
      const repository = createDatabaseDocumentSettingsRepository({ database: fake.database });

      await expect(
        repository.complete({
          attemptId: "settings-attempt-2",
          candidateFingerprint: `projection-set-sha256:${"c".repeat(64)}`,
          candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d33",
          documentId,
          expectedAttemptRowVersion: 0,
          knowledgeSpaceId,
          now: "2026-07-14T12:06:00.000Z",
          tenantId,
        }),
      ).resolves.toMatchObject({
        attempt: { rowVersion: 1, state: "succeeded" },
        head: { activeRevision: 2, rowVersion: 1 },
      });

      const headCas = fake.calls.find(
        (call) => call.tableName === "document_settings_heads" && call.operation === "update",
      );
      expect(headCas?.sql).toContain("row_version");
      expect(headCas?.params.at(-1)).toBe(0);
      const completion = fake.calls.find(
        (call) =>
          call.tableName === "document_reindex_attempts" &&
          call.operation === "update" &&
          call.sql.includes("succeeded"),
      );
      expect(completion?.sql).toContain("row_version");
      expect(completion?.params.at(-1)).toBe(0);
    });
  }
});

function completionDatabase(dialect: "postgres" | "tidb") {
  const calls: DatabaseExecuteInput[] = [];
  let attemptState: "running" | "succeeded" = "running";
  let attemptRowVersion = 0;
  let headRevision = 1;
  let headRowVersion = 0;
  const revisionStates = new Map<number, "active" | "candidate" | "superseded">([
    [1, "active"],
    [2, "candidate"],
  ]);
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.operation === "update") {
      if (input.tableName === "document_settings_heads") {
        headRevision = 2;
        headRowVersion = 1;
      } else if (input.tableName === "document_settings_revisions") {
        const revision = Number(input.params.at(-1));
        if (input.sql.includes("superseded")) revisionStates.set(revision, "superseded");
        if (input.sql.includes("'active'")) revisionStates.set(revision, "active");
      } else if (
        input.tableName === "document_reindex_attempts" &&
        input.sql.includes("succeeded")
      ) {
        attemptState = "succeeded";
        attemptRowVersion = 1;
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (input.tableName === "document_reindex_attempts") {
      return { rows: [attemptRow(attemptState, attemptRowVersion)], rowsAffected: 0 };
    }
    if (input.tableName === "document_settings_heads") {
      return {
        rows: [
          {
            active_revision: headRevision,
            document_id: documentId,
            knowledge_space_id: knowledgeSpaceId,
            row_version: headRowVersion,
            tenant_id: tenantId,
            updated_at: "2026-07-14T12:06:00.000Z",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "document_settings_revisions") {
      const revision = Number(input.params[3]);
      const state = revisionStates.get(revision);
      if (!state) throw new Error(`Unexpected settings revision ${revision}`);
      return { rows: [settingsRow(revision, state)], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 0 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function attemptRow(state: "running" | "succeeded", rowVersion: number) {
  return {
    candidate_fingerprint: state === "succeeded" ? `projection-set-sha256:${"c".repeat(64)}` : null,
    candidate_publication_id: state === "succeeded" ? "018f0d60-7a49-7cc2-9c1b-5b36f18f2d33" : null,
    compilation_attempt_id: "compilation-2",
    completed_at: state === "succeeded" ? "2026-07-14T12:06:00.000Z" : null,
    created_at: "2026-07-14T12:03:00.000Z",
    document_id: documentId,
    document_revision: 1,
    error_code: null,
    error_message: null,
    expected_settings_head_revision: 1,
    id: "settings-attempt-2",
    knowledge_space_id: knowledgeSpaceId,
    row_version: rowVersion,
    settings_revision: 2,
    state,
    tenant_id: tenantId,
    updated_at: "2026-07-14T12:06:00.000Z",
  };
}

function settingsRow(revision: number, state: "active" | "candidate" | "superseded") {
  return {
    activated_at: state === "active" ? "2026-07-14T12:06:00.000Z" : null,
    created_at: "2026-07-14T12:03:00.000Z",
    created_by_subject_id: "editor-a",
    document_id: documentId,
    knowledge_space_id: knowledgeSpaceId,
    revision,
    settings,
    state,
    tenant_id: tenantId,
  };
}
