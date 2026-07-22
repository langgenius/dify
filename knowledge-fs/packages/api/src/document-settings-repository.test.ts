import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseQueryValue,
} from "@knowledge/core";
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

  it("validates the complete settings shape and preserves an omitted language", () => {
    for (const value of [null, [], "settings"]) {
      expect(() => parseDocumentIndexSettings(value)).toThrow(
        "Document settings must be an object",
      );
    }
    for (const chunkSize of [127, 8_193, 512.5]) {
      expect(() => parseDocumentIndexSettings({ ...settings, chunkSize })).toThrow(
        "chunkSize must be between 128 and 8192",
      );
    }
    for (const chunkOverlap of [-1, 512, 1.5]) {
      expect(() => parseDocumentIndexSettings({ ...settings, chunkOverlap })).toThrow(
        "chunkOverlap must be non-negative and less than chunkSize",
      );
    }
    expect(() => parseDocumentIndexSettings({ ...settings, enableGraph: "yes" })).toThrow(
      "enableGraph and enablePageIndex must be booleans",
    );
    expect(() => parseDocumentIndexSettings({ ...settings, enablePageIndex: 1 })).toThrow(
      "enableGraph and enablePageIndex must be booleans",
    );
    for (const language of [1, "english_US"]) {
      expect(() => parseDocumentIndexSettings({ ...settings, language })).toThrow(
        "language must be a BCP-47-like tag",
      );
    }
    const { language: _language, ...withoutLanguage } = settings;
    expect(parseDocumentIndexSettings(withoutLanguage)).toEqual(withoutLanguage);
  });

  it("fences inactive revisions, concurrent attempts, and repository capacity", async () => {
    expect(() => createInMemoryDocumentSettingsRepository({ maxAttempts: 0 })).toThrow(
      "maxAttempts must be positive",
    );
    const inactive = createInMemoryDocumentSettingsRepository({
      isActiveDocumentRevision: async () => false,
      maxAttempts: 2,
    });
    await expect(
      inactive.requestChange({
        compilationAttemptId: "compilation-inactive",
        createdBySubjectId: "editor-a",
        documentId,
        documentRevision: 2,
        expectedSettingsHeadRevision: null,
        knowledgeSpaceId,
        now: "2026-07-14T12:00:00.000Z",
        settings,
        tenantId,
      }),
    ).rejects.toThrow("Document revision is not active");

    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => "settings-attempt-capacity",
      maxAttempts: 1,
    });
    const first = await repository.requestChange({
      compilationAttemptId: "compilation-running",
      createdBySubjectId: "editor-a",
      documentId,
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      settings,
      tenantId,
    });
    await expect(
      repository.getAttempt({
        attemptId: first.attempt.id,
        documentId,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual(first.attempt);
    await expect(
      repository.requestChange({
        compilationAttemptId: "compilation-concurrent",
        createdBySubjectId: "editor-a",
        documentId,
        documentRevision: 1,
        expectedSettingsHeadRevision: null,
        knowledgeSpaceId,
        now: "2026-07-14T12:02:00.000Z",
        settings,
        tenantId,
      }),
    ).rejects.toThrow("Document reindex maxAttempts=1 exceeded");
    await expect(
      repository.attachCompilationAttempt({
        attemptId: first.attempt.id,
        compilationAttemptId: "replacement-compilation",
        documentId,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now: "2026-07-14T12:03:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("Logical document CAS conflict");

    const missingHead = createInMemoryDocumentSettingsRepository({ maxAttempts: 2 });
    await expect(
      missingHead.requestChange({
        compilationAttemptId: "compilation-missing-head",
        createdBySubjectId: "editor-a",
        documentId,
        documentRevision: 1,
        expectedSettingsHeadRevision: 1,
        knowledgeSpaceId,
        now: "2026-07-14T12:04:00.000Z",
        settings,
        tenantId,
      }),
    ).rejects.toThrow("Logical document CAS conflict");
  });

  it("cancels and retries the same candidate while hiding mismatched attempt scopes", async () => {
    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => "settings-attempt-cancel",
      maxAttempts: 2,
    });
    const created = await repository.requestChange({
      compilationAttemptId: "compilation-cancel",
      createdBySubjectId: "editor-a",
      documentId,
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      knowledgeSpaceId,
      now: "2026-07-14T12:00:00.000Z",
      settings,
      tenantId,
    });
    const attemptId = created.attempt.id;
    await expect(
      repository.getAttempt({
        attemptId,
        documentId,
        knowledgeSpaceId,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.cancel({
        attemptId: "missing-attempt",
        documentId,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now: "2026-07-14T12:01:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("Document reindex attempt not found");
    await expect(
      repository.complete({
        attemptId,
        candidateFingerprint: `projection-set-sha256:${"d".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d34",
        documentId,
        expectedAttemptRowVersion: 99,
        knowledgeSpaceId,
        now: "2026-07-14T12:01:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("Logical document CAS conflict");

    const canceled = await repository.cancel({
      attemptId,
      documentId,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now: "2026-07-14T12:02:00.000Z",
      tenantId,
    });
    expect(canceled).toMatchObject({ rowVersion: 1, state: "canceled" });
    const retried = await repository.retry({
      attemptId,
      documentId,
      expectedRowVersion: canceled.rowVersion,
      knowledgeSpaceId,
      now: "2026-07-14T12:03:00.000Z",
      tenantId,
    });
    expect(retried).toMatchObject({ rowVersion: 2, state: "running" });
    await expect(
      repository.retry({
        attemptId,
        documentId,
        expectedRowVersion: retried.rowVersion,
        knowledgeSpaceId,
        now: "2026-07-14T12:04:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("Settings candidate is not retryable");
  });

  it("preserves the active history when later candidates fail or are canceled", async () => {
    let attemptSequence = 0;
    const repository = createInMemoryDocumentSettingsRepository({
      generateAttemptId: () => `settings-attempt-history-${++attemptSequence}`,
      maxAttempts: 4,
    });
    const scope = { documentId, knowledgeSpaceId, tenantId };
    const first = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-history-1",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: null,
      now: "2026-07-14T12:20:00.000Z",
      settings,
    });
    await repository.complete({
      ...scope,
      attemptId: first.attempt.id,
      candidateFingerprint: `projection-set-sha256:${"e".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d35",
      expectedAttemptRowVersion: first.attempt.rowVersion,
      now: "2026-07-14T12:21:00.000Z",
    });

    const second = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-history-2",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: 1,
      now: "2026-07-14T12:22:00.000Z",
      settings: { ...settings, enableGraph: false },
    });
    await repository.fail({
      ...scope,
      attemptId: second.attempt.id,
      errorCode: "CANDIDATE_REJECTED",
      errorMessage: "candidate rejected",
      expectedRowVersion: second.attempt.rowVersion,
      now: "2026-07-14T12:23:00.000Z",
    });

    const third = await repository.requestChange({
      ...scope,
      compilationAttemptId: "compilation-history-3",
      createdBySubjectId: "editor-a",
      documentRevision: 1,
      expectedSettingsHeadRevision: 1,
      now: "2026-07-14T12:24:00.000Z",
      settings: { ...settings, enablePageIndex: false },
    });
    await repository.cancel({
      ...scope,
      attemptId: third.attempt.id,
      expectedRowVersion: third.attempt.rowVersion,
      now: "2026-07-14T12:25:00.000Z",
    });

    await expect(repository.getHead(scope)).resolves.toMatchObject({
      activeRevision: 1,
      profile: { settings },
    });
    await expect(
      repository.getAttempt({ ...scope, attemptId: "settings-attempt-history-missing" }),
    ).resolves.toBeNull();
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

    it(`admits and persists a trusted settings candidate atomically (${dialect})`, async () => {
      const fake = requestDatabase(dialect);
      const repository = createDatabaseDocumentSettingsRepository({
        database: fake.database,
        generateAttemptId: () => "settings-attempt-request",
      });

      await expect(
        repository.requestChange({
          compilationAttemptId: "compilation-request",
          createdBySubjectId: "internal-compiler",
          documentId,
          documentRevision: 1,
          expectedSettingsHeadRevision: null,
          knowledgeSpaceId,
          now: "2026-07-14T12:10:00.000Z",
          settings,
          tenantId,
          trustedInternal: true,
        }),
      ).resolves.toMatchObject({
        attempt: { id: "settings-attempt-request", state: "running" },
        candidate: { revision: 1, state: "candidate" },
      });
      expect(
        fake.calls.find(
          (call) => call.operation === "insert" && call.tableName === "document_settings_revisions",
        )?.params[4],
      ).toBe(JSON.stringify(settings));
      expect(
        fake.calls.find(
          (call) => call.operation === "insert" && call.tableName === "document_reindex_attempts",
        )?.params[0],
      ).toBe("settings-attempt-request");

      const deniedDatabase = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      await expect(
        createDatabaseDocumentSettingsRepository({ database: deniedDatabase }).requestChange({
          compilationAttemptId: "compilation-denied",
          createdBySubjectId: "internal-compiler",
          documentId,
          documentRevision: 1,
          expectedSettingsHeadRevision: null,
          knowledgeSpaceId,
          now: "2026-07-14T12:10:00.000Z",
          settings,
          tenantId,
          trustedInternal: true,
        }),
      ).rejects.toThrow("Document settings candidate admission denied");
    });

    it(`moves a database attempt through attach, fail, retry, and cancel (${dialect})`, async () => {
      const fake = transitionDatabase(dialect);
      const repository = createDatabaseDocumentSettingsRepository({ database: fake.database });
      const scope = { documentId, knowledgeSpaceId, tenantId };

      await expect(
        repository.getAttempt({ ...scope, attemptId: "settings-attempt-transition" }),
      ).resolves.toMatchObject({ rowVersion: 0, state: "queued" });
      await expect(repository.getHead(scope)).resolves.toBeNull();
      const attached = await repository.attachCompilationAttempt({
        ...scope,
        attemptId: "settings-attempt-transition",
        compilationAttemptId: "compilation-attached",
        expectedRowVersion: 0,
        now: "2026-07-14T12:11:00.000Z",
      });
      expect(attached).toMatchObject({
        compilationAttemptId: "compilation-attached",
        rowVersion: 1,
        state: "running",
      });
      const failed = await repository.fail({
        ...scope,
        attemptId: attached.id,
        errorCode: "COMPILATION_TIMEOUT",
        errorMessage: "compilation timed out",
        expectedRowVersion: attached.rowVersion,
        now: "2026-07-14T12:12:00.000Z",
      });
      expect(failed).toMatchObject({
        errorCode: "COMPILATION_TIMEOUT",
        rowVersion: 2,
        state: "failed",
      });
      const retried = await repository.retry({
        ...scope,
        attemptId: failed.id,
        expectedRowVersion: failed.rowVersion,
        now: "2026-07-14T12:13:00.000Z",
      });
      expect(retried).toMatchObject({ rowVersion: 3, state: "running" });
      expect(retried).not.toHaveProperty("errorCode");
      const canceled = await repository.cancel({
        ...scope,
        attemptId: retried.id,
        expectedRowVersion: retried.rowVersion,
        now: "2026-07-14T12:14:00.000Z",
      });
      expect(canceled).toMatchObject({ rowVersion: 4, state: "canceled" });

      await expect(
        repository.attachCompilationAttempt({
          ...scope,
          attemptId: canceled.id,
          compilationAttemptId: "compilation-after-cancel",
          expectedRowVersion: canceled.rowVersion,
          now: "2026-07-14T12:15:00.000Z",
        }),
      ).rejects.toThrow("Logical document CAS conflict");

      const missingDatabase = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: dialect,
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      });
      const missing = createDatabaseDocumentSettingsRepository({ database: missingDatabase });
      await expect(
        missing.getAttempt({ ...scope, attemptId: "missing-attempt" }),
      ).resolves.toBeNull();
      await expect(
        missing.attachCompilationAttempt({
          ...scope,
          attemptId: "missing-attempt",
          compilationAttemptId: "missing-compilation",
          expectedRowVersion: 0,
          now: "2026-07-14T12:15:00.000Z",
        }),
      ).rejects.toThrow("Document reindex attempt not found");
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

function requestDatabase(dialect: "postgres" | "tidb") {
  const calls: DatabaseExecuteInput[] = [];
  let settingsInserted = false;
  let attemptInserted = false;
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (input.tableName === "document_compilation_attempts") {
      return {
        rows: [
          {
            access_channel: null,
            document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
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
      return { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "document_settings_revisions") {
      if (input.operation === "insert") {
        settingsInserted = true;
        return { rows: [], rowsAffected: 1 };
      }
      if (input.sql.includes("MAX")) {
        return { rows: [{ max_revision: 0 }], rowsAffected: 0 };
      }
      return {
        rows: settingsInserted ? [settingsRow(1, "candidate")] : [],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "document_reindex_attempts") {
      if (input.operation === "insert") {
        attemptInserted = true;
        return { rows: [], rowsAffected: 1 };
      }
      return {
        rows: attemptInserted
          ? [
              transitionAttemptRow({
                compilationAttemptId: "compilation-request",
                id: "settings-attempt-request",
                state: "running",
              }),
            ]
          : [],
        rowsAffected: 0,
      };
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

function transitionDatabase(dialect: "postgres" | "tidb") {
  let attempt = transitionAttemptRow({ id: "settings-attempt-transition", state: "queued" });
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    if (input.tableName === "document_settings_heads") {
      return { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "document_settings_revisions") {
      return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
    }
    if (input.tableName === "document_reindex_attempts") {
      if (input.operation === "update") {
        attempt = {
          ...attempt,
          compilation_attempt_id: input.params[2] ?? null,
          completed_at: input.params[6] ?? null,
          error_code: input.params[3] ?? null,
          error_message: input.params[4] ?? null,
          row_version: Number(attempt.row_version) + 1,
          state: input.params[0] ?? null,
          updated_at: input.params[5] ?? null,
        };
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [attempt], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 0 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { database };
}

function transitionAttemptRow(input: {
  readonly compilationAttemptId?: string | null;
  readonly id: string;
  readonly state: "canceled" | "failed" | "queued" | "running" | "succeeded";
}): Record<string, DatabaseQueryValue> {
  return {
    candidate_fingerprint: null,
    candidate_publication_id: null,
    compilation_attempt_id: input.compilationAttemptId ?? null,
    completed_at: null,
    created_at: "2026-07-14T12:10:00.000Z",
    document_id: documentId,
    document_revision: 1,
    error_code: null,
    error_message: null,
    expected_settings_head_revision: 0,
    id: input.id,
    knowledge_space_id: knowledgeSpaceId,
    row_version: 0,
    settings_revision: 1,
    state: input.state,
    tenant_id: tenantId,
    updated_at: "2026-07-14T12:10:00.000Z",
  };
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

function settingsRow(revision: number, state: "active" | "candidate" | "failed" | "superseded") {
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
