import type { Source } from "@knowledge/core";

import type { OnlineDocumentConnector } from "./online-document-connector";
import type { OnlineDriveConnector } from "./online-drive-connector";
import {
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
  readCrawledState,
  syncCrawledPages,
} from "./source-crawl-sync";
import type { SourceCredentialService } from "./source-credential-service";
import type { SourceDocumentMaterializer } from "./source-document-materializer";
import {
  onlineDocumentFilename,
  readImportedFilesState,
  readImportedState,
} from "./source-handlers";
import { safeSourceOperationError, sourceOperationFailureMetadata } from "./source-operation-error";
import { type SourceRepository, SourceVersionConflictError } from "./source-repository";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

export type SourceSyncKind = "none" | "online-document" | "online-drive" | "website-crawl";

export interface SourceSyncOutcome {
  readonly failed: number;
  readonly imported: number;
  readonly kind: SourceSyncKind;
  readonly skipped: number;
}

export interface SourceSyncRunInput {
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId: string;
}

export interface SourceSyncRunner {
  sync(input: SourceSyncRunInput): Promise<SourceSyncOutcome>;
}

export interface SourceSyncRunnerOptions {
  readonly onlineDocumentConnector?: OnlineDocumentConnector | undefined;
  readonly onlineDriveConnector?: OnlineDriveConnector | undefined;
  readonly sourceDocumentMaterializer?: SourceDocumentMaterializer | undefined;
  readonly sourceCredentials?: SourceCredentialService | undefined;
  readonly sources: SourceRepository;
  readonly websiteCrawlConnector?: WebsiteCrawlConnector | undefined;
}

/**
 * Executes one scheduled sync for a source, mirroring the manual sync endpoints:
 * - `web` sources re-run the crawl and materialize every crawled page.
 * - connector sources with imported pages (`metadata.imported`) skip unchanged provider versions
 *   and fail changed entries closed until the durable replacement saga is available.
 * - connector sources with imported drive files (`metadata.importedFiles`) fail closed before
 *   download because their current state has no stable provider version.
 * Sources with nothing to sync resolve to `kind: "none"`. Like the manual endpoints, the runner
 * owns the source's `status` (syncing -> active|error) and sync-summary metadata; hard failures
 * mark the source `error` and rethrow for the scheduler to record.
 */
export function createSourceSyncRunner({
  onlineDocumentConnector,
  onlineDriveConnector,
  sourceDocumentMaterializer,
  sourceCredentials,
  sources,
  websiteCrawlConnector,
}: SourceSyncRunnerOptions): SourceSyncRunner {
  const skippedOutcome = (): SourceSyncOutcome => ({
    failed: 0,
    imported: 0,
    kind: "none",
    skipped: 0,
  });

  async function claimSource(source: Source): Promise<Source | null> {
    try {
      return await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        status: "syncing",
      });
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return null;
      throw error;
    }
  }

  async function markError(source: Source, error: unknown): Promise<never> {
    const failure = safeSourceOperationError("sync", error);
    await sources
      .update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        metadata: {
          ...source.metadata,
          sync: sourceOperationFailureMetadata(failure),
        },
        status: "error",
      })
      .catch(() => undefined);

    throw error;
  }

  async function syncWebsiteCrawl(input: SourceSyncRunInput): Promise<SourceSyncOutcome> {
    if (!websiteCrawlConnector || !sourceDocumentMaterializer) {
      return { failed: 0, imported: 0, kind: "none", skipped: 0 };
    }

    const { tenantId, userId } = input;
    const source = await claimSource(input.source);
    if (!source) return skippedOutcome();

    try {
      const connectorSource = sourceCredentials
        ? await sourceCredentials.resolve({ source, tenantId })
        : source;
      const result = await websiteCrawlConnector.crawl({
        ...(input.signal ? { signal: input.signal } : {}),
        source: connectorSource,
        tenantId,
        userId,
      });
      // Scheduled runs do not impersonate the configured connector user as an authorization
      // principal. New/unchanged pages remain syncable; a replacement fails closed before
      // materialization until the durable sync workflow persists an exact requester binding.
      const materialization = await syncCrawledPages(
        {
          pages: result.pages,
          source,
          tenantId,
        },
        { sourceDocumentMaterializer },
      );

      const committed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        metadata: {
          ...source.metadata,
          crawled: { ...readCrawledState(source.metadata), ...materialization.crawledState },
          sync: {
            completed: result.completed ?? null,
            failed: materialization.failed.length,
            imported: materialization.imported.length,
            pageCount: result.pages.length,
            replaced: materialization.replaced,
            skipped: materialization.skipped,
            status: result.status ?? null,
            total: result.total ?? null,
          },
        },
        status: "active",
      });
      if (!committed) return skippedOutcome();

      return {
        failed: materialization.failed.length,
        imported: materialization.imported.length,
        kind: "website-crawl",
        skipped: materialization.skipped,
      };
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return skippedOutcome();
      return markError(source, error);
    }
  }

  async function syncOnlineDocument(input: SourceSyncRunInput): Promise<SourceSyncOutcome> {
    if (!onlineDocumentConnector || !sourceDocumentMaterializer) {
      return { failed: 0, imported: 0, kind: "none", skipped: 0 };
    }

    const { tenantId, userId } = input;
    const source = await claimSource(input.source);
    if (!source) return skippedOutcome();
    const importedState = readImportedState(source.metadata);

    try {
      const connectorSource = sourceCredentials
        ? await sourceCredentials.resolve({ source, tenantId })
        : source;
      const listing = await onlineDocumentConnector.listPages({
        source: connectorSource,
        tenantId,
        userId,
      });
      const replacementFailures: Array<{ code: string; error: string; filename: string }> = [];
      let failed = 0;
      let skipped = 0;

      for (const workspace of listing.workspaces) {
        for (const page of workspace.pages) {
          const prior = importedState[page.pageId];

          // Scheduled sync only refreshes previously imported pages — selection stays manual.
          if (!prior) {
            continue;
          }

          if (page.lastEditedTime !== undefined && prior.lastEditedTime === page.lastEditedTime) {
            skipped += 1;
            continue;
          }

          const filename = onlineDocumentFilename(page.pageName, page.pageId);

          // Refreshing an existing document is a two-sided transition: publish the new asset and
          // tombstone the old one. Until the durable replacement saga owns both writes, never
          // fetch or materialize replacement bytes.
          replacementFailures.push({
            code: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
            error: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
            filename,
          });
          failed += 1;
        }
      }
      const totalFailed = failed;

      const committed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        metadata: {
          ...source.metadata,
          sync: {
            failed: totalFailed,
            failures: replacementFailures,
            imported: 0,
            skipped,
          },
        },
        status: "active",
      });
      if (!committed) return skippedOutcome();

      return {
        failed: totalFailed,
        imported: 0,
        kind: "online-document",
        skipped,
      };
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return skippedOutcome();
      return markError(source, error);
    }
  }

  async function syncOnlineDrive(input: SourceSyncRunInput): Promise<SourceSyncOutcome> {
    if (!onlineDriveConnector || !sourceDocumentMaterializer) {
      return { failed: 0, imported: 0, kind: "none", skipped: 0 };
    }

    const source = await claimSource(input.source);
    if (!source) return skippedOutcome();
    const importedFiles = readImportedFilesState(source.metadata);

    try {
      const replacementFailures: Array<{ code: string; error: string; filename: string }> = [];
      let failed = 0;

      for (const file of Object.values(importedFiles)) {
        // The drive connector does not expose a stable provider version in ImportedFileState, so
        // a scheduled re-download cannot prove identity. Treat every existing file as a potential
        // replacement and fail before downloading until I4 can replace it atomically.
        replacementFailures.push({
          code: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
          error: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
          filename: file.name,
        });
        failed += 1;
      }
      const totalFailed = failed;

      const committed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        metadata: {
          ...source.metadata,
          sync: {
            failed: totalFailed,
            failures: replacementFailures,
            imported: 0,
            requested: Object.keys(importedFiles).length,
          },
        },
        status: "active",
      });
      if (!committed) return skippedOutcome();

      return {
        failed: totalFailed,
        imported: 0,
        kind: "online-drive",
        skipped: 0,
      };
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return skippedOutcome();
      return markError(source, error);
    }
  }

  return {
    sync: async (input) => {
      const { source } = input;

      if (source.type === "web") {
        return syncWebsiteCrawl(input);
      }

      if (source.type !== "connector") {
        return { failed: 0, imported: 0, kind: "none", skipped: 0 };
      }

      // Connector kinds are indistinguishable by config alone; dispatch on what was imported.
      if (Object.keys(readImportedState(source.metadata)).length > 0) {
        return syncOnlineDocument(input);
      }

      if (Object.keys(readImportedFilesState(source.metadata)).length > 0) {
        return syncOnlineDrive(input);
      }

      return { failed: 0, imported: 0, kind: "none", skipped: 0 };
    },
  };
}
