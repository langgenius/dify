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
const scope = { documentId, knowledgeSpaceId, tenantId };
const settings = {
  chunkOverlap: 64,
  chunkSize: 512,
  enableGraph: true,
  enablePageIndex: true,
  language: "en-US",
};

describe("in-memory document settings behavior", () => {
  it("validates every bounded settings field and returns a detached value", () => {
    for (const [value, message] of [
      [null, "must be an object"],
      [[], "must be an object"],
      [{ ...settings, chunkSize: 127 }, "chunkSize must be between"],
      [{ ...settings, chunkSize: 8_193 }, "chunkSize must be between"],
      [{ ...settings, chunkOverlap: -1 }, "chunkOverlap must be"],
      [{ ...settings, enableGraph: "yes" }, "must be booleans"],
      [{ ...settings, enablePageIndex: 1 }, "must be booleans"],
      [{ ...settings, language: "not a locale!" }, "BCP-47-like"],
    ] as const) {
      expect(() => parseDocumentIndexSettings(value)).toThrow(message);
    }

    const parsed = parseDocumentIndexSettings({ ...settings, language: undefined });
    expect(parsed).toEqual({ ...settings, language: undefined });
    expect(Object.hasOwn(parsed, "language")).toBe(false);
  });

  it("rejects invalid repository bounds and inactive document revisions", async () => {
    expect(() => createInMemoryDocumentSettingsRepository({ maxAttempts: 0 })).toThrow(
      "maxAttempts must be positive",
    );
    expect(() => createInMemoryDocumentSettingsRepository({ maxAttempts: 1.5 })).toThrow(
      "maxAttempts must be positive",
    );

    const repository = createInMemoryDocumentSettingsRepository({
      isActiveDocumentRevision: async () => false,
      maxAttempts: 1,
    });
    await expect(
      repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-1",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:00:00.000Z",
        settings,
      }),
    ).rejects.toThrow("Document revision is not active");
  });

  it("scopes attempts, rejects concurrent work, and restores a canceled candidate", async () => {
    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => "attempt-1",
      maxAttempts: 2,
    });
    const requested = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
    });
    await expect(
      repository.getAttempt({ ...scope, attemptId: "attempt-1", tenantId: "tenant-b" }),
    ).resolves.toBeNull();
    await expect(
      repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-2",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:01:00.000Z",
        settings,
      }),
    ).rejects.toThrow("already has an active reindex attempt");
    await expect(
      repository.attachCompilationAttempt({
        ...scope,
        attemptId: requested.attempt.id,
        compilationAttemptId: "other-compilation",
        expectedRowVersion: 0,
        now: "2026-07-21T12:02:00.000Z",
      }),
    ).rejects.toThrow("Logical document CAS conflict");

    const canceled = await repository.cancel({
      ...scope,
      attemptId: requested.attempt.id,
      expectedRowVersion: 0,
      now: "2026-07-21T12:03:00.000Z",
    });
    expect(canceled).toMatchObject({ completedAt: "2026-07-21T12:03:00.000Z", state: "canceled" });
    const retried = await repository.retry({
      ...scope,
      attemptId: requested.attempt.id,
      expectedRowVersion: canceled.rowVersion,
      now: "2026-07-21T12:04:00.000Z",
    });
    expect(retried).toMatchObject({ state: "running" });
    expect(retried.completedAt).toBeUndefined();
    await expect(
      repository.retry({
        ...scope,
        attemptId: requested.attempt.id,
        expectedRowVersion: retried.rowVersion,
        now: "2026-07-21T12:05:00.000Z",
      }),
    ).rejects.toThrow("candidate is not retryable");
    await expect(
      repository.complete({
        ...scope,
        attemptId: requested.attempt.id,
        candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
        expectedAttemptRowVersion: 99,
        now: "2026-07-21T12:05:00.000Z",
      }),
    ).rejects.toThrow("Logical document CAS conflict");
  });

  it("fails closed on missing attempts and stale terminal transitions", async () => {
    const repository = createInMemoryDocumentSettingsRepository({ maxAttempts: 1 });
    await expect(repository.getAttempt({ ...scope, attemptId: "missing" })).resolves.toBeNull();
    for (const operation of [
      () =>
        repository.cancel({
          ...scope,
          attemptId: "missing",
          expectedRowVersion: 0,
          now: "2026-07-21T12:00:00.000Z",
        }),
      () =>
        repository.fail({
          ...scope,
          attemptId: "missing",
          errorCode: "FAILED",
          errorMessage: "failed",
          expectedRowVersion: 0,
          now: "2026-07-21T12:00:00.000Z",
        }),
      () =>
        repository.retry({
          ...scope,
          attemptId: "missing",
          expectedRowVersion: 0,
          now: "2026-07-21T12:00:00.000Z",
        }),
    ]) {
      await expect(operation()).rejects.toThrow("not found");
    }
  });

  it("enforces the bounded attempt ledger after a terminal failure", async () => {
    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => "attempt-1",
      maxAttempts: 1,
    });
    const requested = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
    });
    await repository.fail({
      ...scope,
      attemptId: requested.attempt.id,
      errorCode: "FAILED",
      errorMessage: "failed",
      expectedRowVersion: 0,
      now: "2026-07-21T12:01:00.000Z",
    });
    await expect(
      repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-2",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:02:00.000Z",
        settings,
      }),
    ).rejects.toThrow("maxAttempts=1 exceeded");
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`persists, fails, retries, and cancels a candidate through explicit database CAS (${dialect})`, async () => {
      const fake = documentSettingsDatabase(dialect);
      const repository = createDatabaseDocumentSettingsRepository({
        database: fake.database,
        generateAttemptId: () => "attempt-1",
      });
      const requested = await repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-1",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:00:00.000Z",
        settings,
        trustedInternal: true,
      });
      expect(requested).toMatchObject({
        attempt: { id: "attempt-1", state: "running" },
        candidate: { revision: 1, state: "candidate" },
      });

      const failed = await repository.fail({
        ...scope,
        attemptId: "attempt-1",
        errorCode: "SMOKE_FAILED",
        errorMessage: "candidate rejected",
        expectedRowVersion: 0,
        now: "2026-07-21T12:01:00.000Z",
      });
      expect(failed).toMatchObject({ errorCode: "SMOKE_FAILED", rowVersion: 1, state: "failed" });
      const retried = await repository.retry({
        ...scope,
        attemptId: "attempt-1",
        expectedRowVersion: 1,
        now: "2026-07-21T12:02:00.000Z",
      });
      expect(retried).toMatchObject({ rowVersion: 2, state: "running" });
      const canceled = await repository.cancel({
        ...scope,
        attemptId: "attempt-1",
        expectedRowVersion: 2,
        now: "2026-07-21T12:03:00.000Z",
      });
      expect(canceled).toMatchObject({ rowVersion: 3, state: "canceled" });
      expect(fake.calls.some((call) => call.tableName === "knowledge_spaces")).toBe(true);
      expect(fake.calls.some((call) => call.tableName === "document_revisions")).toBe(true);
    });

    it(`publishes the first database settings head atomically (${dialect})`, async () => {
      const fake = documentSettingsDatabase(dialect);
      const repository = createDatabaseDocumentSettingsRepository({
        database: fake.database,
        generateAttemptId: () => "attempt-1",
      });
      await repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-1",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:00:00.000Z",
        settings,
        trustedInternal: true,
      });

      await expect(
        repository.complete({
          ...scope,
          attemptId: "attempt-1",
          candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
          candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
          expectedAttemptRowVersion: 0,
          now: "2026-07-21T12:01:00.000Z",
        }),
      ).resolves.toMatchObject({
        attempt: { state: "succeeded" },
        head: { activeRevision: 1, profile: { state: "active" }, rowVersion: 0 },
      });
      expect(
        fake.calls.some(
          (call) => call.operation === "insert" && call.tableName === "document_settings_heads",
        ),
      ).toBe(true);
    });
  }

  it("maps database corruption and stale CAS states to domain failures", async () => {
    const fake = documentSettingsDatabase("postgres");
    const repository = createDatabaseDocumentSettingsRepository({
      database: fake.database,
      generateAttemptId: () => "attempt-1",
    });
    await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    fake.patchAttempt({ state: "unknown" });
    await expect(repository.getAttempt({ ...scope, attemptId: "attempt-1" })).rejects.toThrow(
      "Invalid document reindex state",
    );
    fake.patchAttempt({ row_version: 0, state: "running" });
    await expect(
      repository.complete({
        ...scope,
        attemptId: "attempt-1",
        candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
        expectedAttemptRowVersion: 7,
        now: "2026-07-21T12:01:00.000Z",
      }),
    ).rejects.toThrow("Logical document CAS conflict");
    fake.patchAttempt({ state: "failed" });
    await expect(
      repository.retry({
        ...scope,
        attemptId: "attempt-1",
        expectedRowVersion: 7,
        now: "2026-07-21T12:02:00.000Z",
      }),
    ).rejects.toThrow("Logical document CAS conflict");
  });

  it("rejects candidate admission and corrupt persisted heads", async () => {
    const denied = documentSettingsDatabase("postgres");
    denied.denyAdmission();
    const deniedRepository = createDatabaseDocumentSettingsRepository({
      database: denied.database,
    });
    await expect(
      deniedRepository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-1",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:00:00.000Z",
        settings,
        trustedInternal: true,
      }),
    ).rejects.toThrow("candidate admission denied");

    const corrupt = documentSettingsDatabase("postgres");
    const repository = createDatabaseDocumentSettingsRepository({
      database: corrupt.database,
      generateAttemptId: () => "attempt-1",
    });
    await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    await repository.complete({
      ...scope,
      attemptId: "attempt-1",
      candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
      expectedAttemptRowVersion: 0,
      now: "2026-07-21T12:01:00.000Z",
    });
    corrupt.setRevisionState(1, "candidate");
    await expect(repository.getHead(scope)).rejects.toThrow("settings head is corrupt");
    corrupt.setRevisionState(1, "unknown");
    await expect(repository.getHead(scope)).rejects.toThrow("Invalid document settings state");
  });

  it("fails closed when database candidates or CAS mutations disappear", async () => {
    const missing = documentSettingsDatabase("postgres");
    const missingRepository = createDatabaseDocumentSettingsRepository({
      database: missing.database,
    });
    await expect(
      missingRepository.cancel({
        ...scope,
        attemptId: "missing",
        expectedRowVersion: 0,
        now: "2026-07-21T12:00:00.000Z",
      }),
    ).rejects.toThrow("not found");
    await expect(
      missingRepository.complete({
        ...scope,
        attemptId: "missing",
        candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
        expectedAttemptRowVersion: 0,
        now: "2026-07-21T12:00:00.000Z",
      }),
    ).rejects.toThrow("not found");
    await expect(
      missingRepository.retry({
        ...scope,
        attemptId: "missing",
        expectedRowVersion: 0,
        now: "2026-07-21T12:00:00.000Z",
      }),
    ).rejects.toThrow("not found");

    const attach = documentSettingsDatabase("postgres");
    const attachRepository = createDatabaseDocumentSettingsRepository({
      database: attach.database,
      generateAttemptId: () => "attempt-1",
    });
    await attachRepository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    attach.patchAttempt({ compilation_attempt_id: null, state: "queued" });
    await expect(
      attachRepository.attachCompilationAttempt({
        ...scope,
        attemptId: "attempt-1",
        compilationAttemptId: "compilation-2",
        expectedRowVersion: 0,
        now: "2026-07-21T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({ compilationAttemptId: "compilation-2", state: "running" });

    const lostCas = documentSettingsDatabase("postgres");
    const lostCasRepository = createDatabaseDocumentSettingsRepository({
      database: lostCas.database,
      generateAttemptId: () => "attempt-1",
    });
    await lostCasRepository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    lostCas.failNextUpdate("document_reindex_attempts");
    await expect(
      lostCasRepository.fail({
        ...scope,
        attemptId: "attempt-1",
        errorCode: "FAILED",
        errorMessage: "failed",
        expectedRowVersion: 0,
        now: "2026-07-21T12:01:00.000Z",
      }),
    ).rejects.toThrow("Logical document CAS conflict");

    const missingCandidate = documentSettingsDatabase("postgres");
    const missingCandidateRepository = createDatabaseDocumentSettingsRepository({
      database: missingCandidate.database,
      generateAttemptId: () => "attempt-1",
    });
    await missingCandidateRepository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    missingCandidate.deleteRevision(1);
    await expect(
      missingCandidateRepository.complete({
        ...scope,
        attemptId: "attempt-1",
        candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
        expectedAttemptRowVersion: 0,
        now: "2026-07-21T12:01:00.000Z",
      }),
    ).rejects.toThrow("candidate is not activatable");
  });

  it("rejects failed candidate-state CAS for cancel and retry", async () => {
    const fake = documentSettingsDatabase("postgres");
    const repository = createDatabaseDocumentSettingsRepository({
      database: fake.database,
      generateAttemptId: () => "attempt-1",
    });
    await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    fake.failNextUpdate("document_settings_revisions");
    await expect(
      repository.cancel({
        ...scope,
        attemptId: "attempt-1",
        expectedRowVersion: 0,
        now: "2026-07-21T12:01:00.000Z",
      }),
    ).rejects.toThrow("candidate is not cancelable");

    const retry = documentSettingsDatabase("postgres");
    const retryRepository = createDatabaseDocumentSettingsRepository({
      database: retry.database,
      generateAttemptId: () => "attempt-1",
    });
    await retryRepository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    await retryRepository.fail({
      ...scope,
      attemptId: "attempt-1",
      errorCode: "FAILED",
      errorMessage: "failed",
      expectedRowVersion: 0,
      now: "2026-07-21T12:01:00.000Z",
    });
    retry.failNextUpdate("document_settings_revisions");
    await expect(
      retryRepository.retry({
        ...scope,
        attemptId: "attempt-1",
        expectedRowVersion: 1,
        now: "2026-07-21T12:02:00.000Z",
      }),
    ).rejects.toThrow("candidate is not retryable");
  });

  it("requires trusted internal provenance and exact persisted head revision", async () => {
    const untrusted = documentSettingsDatabase("postgres");
    const untrustedRepository = createDatabaseDocumentSettingsRepository({
      database: untrusted.database,
    });
    await expect(
      untrustedRepository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-1",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:00:00.000Z",
        settings,
      }),
    ).rejects.toThrow("candidate admission denied");

    const fake = documentSettingsDatabase("postgres");
    const repository = createDatabaseDocumentSettingsRepository({
      database: fake.database,
      generateAttemptId: () => "attempt-1",
    });
    await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-21T12:00:00.000Z",
      settings,
      trustedInternal: true,
    });
    await repository.complete({
      ...scope,
      attemptId: "attempt-1",
      candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
      expectedAttemptRowVersion: 0,
      now: "2026-07-21T12:01:00.000Z",
    });
    await expect(
      repository.requestChange({
        ...scope,
        compilationAttemptId: "compilation-2",
        createdBySubjectId: "editor-a",
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        now: "2026-07-21T12:02:00.000Z",
        settings,
        trustedInternal: true,
      }),
    ).rejects.toThrow("Logical document CAS conflict");
  });
});

function documentSettingsDatabase(dialect: "postgres" | "tidb") {
  const calls: DatabaseExecuteInput[] = [];
  let attempt: Record<string, unknown> | undefined;
  let head: Record<string, unknown> | undefined;
  let admissionDenied = false;
  let failedUpdateTable: string | undefined;
  const revisions = new Map<number, Record<string, unknown>>();

  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.operation === "select") {
      if (input.tableName === "knowledge_spaces") {
        return {
          rows: admissionDenied
            ? []
            : [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "document_compilation_attempts") {
        return {
          rows: [
            {
              access_channel: null,
              document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
              document_version: 1,
              permission_snapshot_id: null,
              permission_snapshot_revision: null,
              requested_by_subject_id: null,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "document_assets") {
        return { rows: [{ metadata: {}, source_id: null }], rowsAffected: 0 };
      }
      if (input.tableName === "logical_documents") {
        return { rows: [{ id: documentId }], rowsAffected: 0 };
      }
      if (input.tableName === "document_revisions") {
        return { rows: [{ revision: 1 }], rowsAffected: 0 };
      }
      if (input.tableName === "document_settings_heads") {
        return { rows: head ? [{ ...head }] : [], rowsAffected: 0 };
      }
      if (input.tableName === "document_settings_revisions") {
        if (input.sql.includes("COALESCE(MAX")) {
          return {
            rows: [{ max_revision: Math.max(0, ...revisions.keys()) }],
            rowsAffected: 0,
          };
        }
        const revision = Number(input.params[3]);
        const row = revisions.get(revision);
        return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
      }
      if (input.tableName === "document_reindex_attempts") {
        return { rows: attempt ? [{ ...attempt }] : [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    }

    if (input.operation === "insert") {
      if (input.tableName === "document_settings_revisions") {
        const revision = Number(input.params[3]);
        revisions.set(revision, {
          activated_at: null,
          created_at: String(input.params[6]),
          created_by_subject_id: String(input.params[5]),
          document_id: documentId,
          knowledge_space_id: knowledgeSpaceId,
          revision,
          settings: JSON.parse(String(input.params[4])),
          state: "candidate",
          tenant_id: tenantId,
        });
      } else if (input.tableName === "document_reindex_attempts") {
        attempt = {
          candidate_fingerprint: null,
          candidate_publication_id: null,
          compilation_attempt_id: input.params[7],
          completed_at: null,
          created_at: input.params[8],
          document_id: documentId,
          document_revision: input.params[4],
          error_code: null,
          error_message: null,
          expected_settings_head_revision: input.params[6],
          id: input.params[0],
          knowledge_space_id: knowledgeSpaceId,
          row_version: 0,
          settings_revision: input.params[5],
          state: "running",
          tenant_id: tenantId,
          updated_at: input.params[9],
        };
      } else if (input.tableName === "document_settings_heads") {
        head = {
          active_revision: input.params[3],
          document_id: documentId,
          knowledge_space_id: knowledgeSpaceId,
          row_version: 0,
          tenant_id: tenantId,
          updated_at: input.params[4],
        };
      }
      return { rows: [], rowsAffected: 1 };
    }

    if (failedUpdateTable === input.tableName) {
      failedUpdateTable = undefined;
      return { rows: [], rowsAffected: 0 };
    }

    if (input.tableName === "document_settings_revisions") {
      const revision = Number(input.params.at(-1));
      const current = revisions.get(revision);
      if (!current) return { rows: [], rowsAffected: 0 };
      if (input.sql.includes("'superseded'")) current.state = "superseded";
      else if (input.sql.includes("'active'")) {
        current.state = "active";
        current.activated_at = input.params[0];
      } else if (input.sql.includes("'candidate'")) current.state = "candidate";
      else if (input.sql.includes("'failed'")) current.state = "failed";
      return { rows: [], rowsAffected: 1 };
    }
    if (input.tableName === "document_reindex_attempts" && attempt) {
      if (input.sql.includes("'succeeded'")) {
        attempt.state = "succeeded";
        attempt.candidate_publication_id = input.params[0];
        attempt.candidate_fingerprint = input.params[1];
        attempt.updated_at = input.params[2];
        attempt.completed_at = input.params[2];
      } else {
        attempt.state = input.params[0];
        attempt.compilation_attempt_id = input.params[2];
        attempt.error_code = input.params[3];
        attempt.error_message = input.params[4];
        attempt.updated_at = input.params[5];
        attempt.completed_at = input.params[6];
      }
      attempt.row_version = Number(attempt.row_version) + 1;
      return { rows: [], rowsAffected: 1 };
    }
    if (input.tableName === "document_settings_heads" && head) {
      head.active_revision = input.params[0];
      head.updated_at = input.params[1];
      head.row_version = Number(head.row_version) + 1;
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 1 };
  };

  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return {
    calls,
    database,
    denyAdmission: () => {
      admissionDenied = true;
    },
    deleteRevision: (revision: number) => {
      revisions.delete(revision);
    },
    failNextUpdate: (tableName: string) => {
      failedUpdateTable = tableName;
    },
    patchAttempt: (patch: Record<string, unknown>) => {
      if (!attempt) throw new Error("attempt is unavailable");
      Object.assign(attempt, patch);
    },
    setRevisionState: (revision: number, state: string) => {
      const current = revisions.get(revision);
      if (!current) throw new Error("settings revision is unavailable");
      current.state = state;
    },
  };
}
