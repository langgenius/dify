import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  createDatabaseDocumentCompilationIndexOverrideResolver,
  createDatabaseDocumentLogicalMutationReconciler,
  createDocumentSettingsChangeCoordinator,
} from "./document-logical-mutation-runtime";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";

describe("document logical mutation runtime", () => {
  it("leaves success activation to publication and fails only terminal candidates", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async (input): Promise<DatabaseExecuteResult> => {
        const succeeded = input.sql.includes("'succeeded'") && input.sql.includes("checkpoint");
        if (succeeded && input.tableName === "document_revisions") {
          return {
            rows: [
              {
                document_id: documentId,
                expected_active_revision: null,
                expected_document_row_version: 0,
                knowledge_space_id: knowledgeSpaceId,
                revision: 1,
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (succeeded && input.tableName === "document_reindex_attempts") {
          return {
            rows: [
              {
                candidate_fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
                candidate_publication_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
                document_id: documentId,
                id: "settings-attempt",
                knowledge_space_id: knowledgeSpaceId,
                row_version: 2,
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (succeeded && input.tableName === "document_chunk_state_changes") {
          return {
            rows: [
              {
                candidate_fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
                candidate_publication_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
                document_id: documentId,
                id: "chunk-change",
                knowledge_space_id: knowledgeSpaceId,
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (!succeeded && input.tableName === "document_revisions") {
          return {
            rows: [
              {
                document_id: documentId,
                knowledge_space_id: knowledgeSpaceId,
                revision: 2,
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (!succeeded && input.tableName === "document_reindex_attempts") {
          return {
            rows: [
              {
                document_id: documentId,
                id: "failed-settings",
                knowledge_space_id: knowledgeSpaceId,
                last_error_code: "COMPILE_FAILED",
                last_error_message: "compile failed",
                row_version: 4,
                run_state: "failed",
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (!succeeded && input.tableName === "document_chunk_state_changes") {
          return {
            rows: [
              {
                document_id: documentId,
                id: "failed-chunk",
                knowledge_space_id: knowledgeSpaceId,
                tenant_id: tenantId,
              },
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
      kind: "postgres",
    });
    const chunks = {
      activateStateChange: vi.fn(async (input) => ({ ...input })),
      failStateChange: vi.fn(async (input) => ({ ...input })),
    };
    const logicalDocuments = {
      activateRevision: vi.fn(async (input) => ({ ...input })),
      failCandidate: vi.fn(async (input) => ({ ...input })),
    };
    const settings = {
      complete: vi.fn(async (input) => ({ ...input })),
      fail: vi.fn(async (input) => ({ ...input })),
    };
    const reconciler = createDatabaseDocumentLogicalMutationReconciler({
      chunks: chunks as never,
      database,
      logicalDocuments: logicalDocuments as never,
      now: () => "2026-07-14T12:10:00.000Z",
      settings: settings as never,
    });

    await expect(reconciler.tick()).resolves.toEqual({
      chunksActivated: 0,
      chunksFailed: 1,
      revisionsActivated: 0,
      revisionsFailed: 1,
      settingsCompleted: 0,
      settingsFailed: 1,
    });
    expect(logicalDocuments.activateRevision).not.toHaveBeenCalled();
    expect(settings.complete).not.toHaveBeenCalled();
    expect(chunks.activateStateChange).not.toHaveBeenCalled();
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`resolves settings and chunk exclusions only from the exact running attempt (${dialect})`, async () => {
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "document_reindex_attempts") {
            return { rows: [{ settings }], rowsAffected: 0 };
          }
          if (input.sql.includes("active_change")) {
            return { rows: [{ ordinal: 1 }, { ordinal: 2 }], rowsAffected: 0 };
          }
          if (input.tableName === "document_chunk_state_changes") {
            return {
              rows: [
                {
                  chunk_id: "chunk-3",
                  document_id: documentId,
                  document_revision: 1,
                  enabled: dialect === "postgres" ? false : 0,
                  ordinal: 3,
                },
              ],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const resolver = createDatabaseDocumentCompilationIndexOverrideResolver(database);

      await expect(
        resolver.resolve({
          compilationAttemptId: "compilation-1",
          documentAssetId: "asset-1",
          documentAssetVersion: 1,
          knowledgeSpaceId,
          tenantId,
        }),
      ).resolves.toEqual({
        chunkConfig: { maxChunkChars: 512, overlapChars: 64 },
        enableGraph: true,
        enablePageIndex: true,
        excludedNodeOrdinals: [1, 2, 3],
      });
    });

    it(`falls back to the target document's active settings for ordinary compilation (${dialect})`, async () => {
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "document_settings_heads") {
            return {
              rows: [
                {
                  settings: {
                    ...settings,
                    enableGraph: false,
                    enablePageIndex: false,
                    language: "zh-CN",
                  },
                },
              ],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const resolver = createDatabaseDocumentCompilationIndexOverrideResolver(database);

      await expect(
        resolver.resolve({
          compilationAttemptId: "ordinary-compilation-1",
          documentAssetId: "asset-1",
          documentAssetVersion: 1,
          knowledgeSpaceId,
          tenantId,
        }),
      ).resolves.toEqual({
        chunkConfig: { maxChunkChars: 512, overlapChars: 64 },
        enableGraph: false,
        enablePageIndex: false,
        language: "zh-CN",
      });
    });
  }

  it("cancels the compilation when settings candidate staging fails", async () => {
    const cancel = vi.fn(async () => undefined);
    const coordinator = createDocumentSettingsChangeCoordinator({
      compilationJobs: {
        cancel,
        start: vi.fn(async () => ({ id: "compilation-1" })),
      } as never,
      logicalDocuments: {
        get: vi.fn(async () => ({
          active: { documentAssetId: "asset-1", documentAssetVersion: 1, revision: 1 },
        })),
      } as never,
      settings: {
        requestChange: vi.fn(async () => {
          throw new Error("injected settings persistence failure");
        }),
      } as never,
    });

    await expect(
      coordinator.request({
        documentId,
        expectedSettingsHeadRevision: null,
        knowledgeSpaceId,
        settings,
        subjectId: "editor-a",
        tenantId,
      }),
    ).rejects.toThrow("injected settings persistence failure");
    expect(cancel).toHaveBeenCalledWith(
      "compilation-1",
      "Document settings candidate staging failed",
    );
  });

  it("releases settings compilation dispatch only after the candidate is durable", async () => {
    const order: string[] = [];
    const coordinator = createDocumentSettingsChangeCoordinator({
      compilationJobs: {
        cancel: vi.fn(),
        releaseDispatch: vi.fn(async () => {
          order.push("release");
        }),
        start: vi.fn(async () => {
          order.push("start");
          return { id: "compilation-1" };
        }),
      } as never,
      logicalDocuments: {
        get: vi.fn(async () => ({
          active: { documentAssetId: "asset-1", documentAssetVersion: 1, revision: 1 },
        })),
      } as never,
      settings: {
        requestChange: vi.fn(async () => {
          order.push("stage");
          return {
            attempt: { id: "settings-attempt-1" },
            candidate: { revision: 2 },
          };
        }),
      } as never,
    });

    await expect(
      coordinator.request({
        documentId,
        expectedSettingsHeadRevision: 1,
        knowledgeSpaceId,
        settings,
        subjectId: "editor-a",
        tenantId,
      }),
    ).resolves.toMatchObject({ compilationAttemptId: "compilation-1", settingsRevision: 2 });
    expect(order).toEqual(["start", "stage", "release"]);
  });
});

const settings = {
  chunkOverlap: 64,
  chunkSize: 512,
  enableGraph: true,
  enablePageIndex: true,
};
