import type { Source } from "@knowledge/core";

import { sha256Hex } from "./document-upload-utils";
import type {
  FailedSourceDocument,
  MaterializedSourceDocument,
  SourceDocumentInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";
import type { CrawledPage } from "./website-crawl-connector";

/** Per-URL provenance recorded as `metadata.crawled` so re-crawls can dedupe by content hash. */
export interface CrawledPageState {
  readonly documentAssetId: string;
  readonly sha256: string;
}

export function readCrawledState(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, CrawledPageState> {
  const value = metadata.crawled;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, CrawledPageState> = {};

  for (const [url, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;

      if (typeof record.documentAssetId === "string" && typeof record.sha256 === "string") {
        result[url] = { documentAssetId: record.documentAssetId, sha256: record.sha256 };
      }
    }
  }

  return result;
}

export interface SyncCrawledPagesInput {
  readonly pages: readonly CrawledPage[];
  readonly source: Source;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
}

export interface SyncCrawledPagesDeps {
  readonly sourceDocumentMaterializer: SourceDocumentMaterializer;
}

export interface SyncCrawledPagesResult {
  /** Next `metadata.crawled` state (skipped pages keep their prior entry). */
  readonly crawledState: Record<string, CrawledPageState>;
  readonly failed: readonly FailedSourceDocument[];
  readonly imported: readonly MaterializedSourceDocument[];
  /** Superseded documents replaced atomically; remains zero until the I4 saga is available. */
  readonly replaced: number;
  /** Pages whose content hash is unchanged since the last crawl. */
  readonly skipped: number;
}

const textEncoder = new TextEncoder();
export const SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED =
  "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED";
export const SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE =
  "Changed-page replacement requires the durable source-sync replacement saga";

/**
 * Materializes a crawl result with content-hash dedup: pages whose content is byte-identical to
 * the last crawl (per `metadata.crawled`) are skipped and new pages are imported. Changed pages
 * fail per-page before materialization until the durable replacement saga can atomically publish
 * the replacement and tombstone the prior document.
 * Pages that disappeared from the crawl keep their document and state entry.
 */
export async function syncCrawledPages(
  { pages, source, tenantId, traceId }: SyncCrawledPagesInput,
  { sourceDocumentMaterializer }: SyncCrawledPagesDeps,
): Promise<SyncCrawledPagesResult> {
  const priorState = readCrawledState(source.metadata);
  const documents: SourceDocumentInput[] = [];
  // filename -> provenance, to fold materialized documents back into the crawled state.
  const pending = new Map<string, { sha256: string; url: string }>();
  const replacementFailures: FailedSourceDocument[] = [];
  let skipped = 0;

  for (const page of pages) {
    const body = textEncoder.encode(page.content);
    const contentHash = await sha256Hex(body);
    const prior = priorState[page.sourceUrl];

    if (prior && prior.sha256 === contentHash) {
      skipped += 1;
      continue;
    }

    const filename = crawledPageFilename(page, contentHash);
    if (prior) {
      // I2 deliberately cannot make "materialize replacement + tombstone prior asset" atomic.
      // Keep the prior state authoritative and never pass changed bytes to the materializer until
      // the I4 durable source-sync replacement saga owns both sides of that transition.
      replacementFailures.push({
        code: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
        error: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
        filename,
      });
      continue;
    }
    documents.push({
      body,
      filename,
      metadata: {
        dataSourceInfo: {
          url: page.sourceUrl,
          ...(page.title === undefined ? {} : { title: page.title }),
        },
        dataSourceType: "website_crawl",
      },
      mimeType: "text/markdown",
    });
    pending.set(filename, {
      sha256: contentHash,
      url: page.sourceUrl,
    });
  }

  const materialization =
    documents.length > 0
      ? await sourceDocumentMaterializer.materialize({
          documents,
          knowledgeSpaceId: source.knowledgeSpaceId,
          permissionScope: source.permissionScope,
          sourceId: source.id,
          tenantId,
          ...(traceId === undefined ? {} : { traceId }),
        })
      : { documents: [], failed: [] };
  const crawledState = { ...priorState };

  for (const materialized of materialization.documents) {
    const info = pending.get(materialized.filename);

    if (!info) {
      continue;
    }

    crawledState[info.url] = {
      documentAssetId: materialized.documentAssetId,
      sha256: info.sha256,
    };
  }

  return {
    crawledState,
    failed: [...replacementFailures, ...materialization.failed],
    imported: materialization.documents,
    replaced: 0,
    skipped,
  };
}

/**
 * Filename for a crawled page. Suffixed with a content-hash fragment so filenames are unique per
 * page (used to fold materialized documents back into the crawled state without collisions when
 * two pages share a title).
 */
export function crawledPageFilename(page: CrawledPage, contentHash: string): string {
  const base = (page.title ?? page.sourceUrl)
    .replace(/^https?:\/\//iu, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);

  return `${base || "page"}-${contentHash.slice(0, 8)}.md`;
}
