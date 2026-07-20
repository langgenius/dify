import { type Source, SourceSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "./document-upload-utils";
import { crawledPageFilename, readCrawledState, syncCrawledPages } from "./source-crawl-sync";
import type {
  MaterializeSourceDocumentsInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";

const textEncoder = new TextEncoder();

function webSource(
  metadata: Record<string, unknown> = {},
  permissionScope: readonly string[] = [],
): Source {
  return SourceSchema.parse({
    createdAt: "2026-07-08T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata,
    name: "Docs crawl",
    permissionScope,
    status: "active",
    type: "web",
    updatedAt: "2026-07-08T00:00:00.000Z",
    uri: "https://example.com",
  });
}

function fakeMaterializer(): SourceDocumentMaterializer & {
  batches: number[];
  calls: MaterializeSourceDocumentsInput[];
} {
  const batches: number[] = [];
  const calls: MaterializeSourceDocumentsInput[] = [];

  return {
    batches,
    calls,
    compensate: async () => undefined,
    materialize: async (input) => {
      calls.push(input);
      batches.push(input.documents.length);

      return {
        documents: input.documents.map((document, index) => ({
          documentAssetId: `doc-${batches.length}-${index}`,
          documentAssetVersion: 1,
          filename: document.filename,
          mimeType: document.mimeType,
          sizeBytes: document.body.byteLength,
        })),
        failed: [],
      };
    },
  };
}

describe("syncCrawledPages", () => {
  it("imports new pages, skips unchanged ones, and fails changed pages before materialization", async () => {
    const materializer = fakeMaterializer();

    // First crawl: everything is new.
    const first = await syncCrawledPages(
      {
        pages: [
          { content: "alpha", sourceUrl: "https://example.com/a", title: "A" },
          { content: "beta", sourceUrl: "https://example.com/b", title: "B" },
        ],
        source: webSource(),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: materializer },
    );
    expect(first.imported).toHaveLength(2);
    expect(first.skipped).toBe(0);
    expect(first.replaced).toBe(0);
    expect(Object.keys(first.crawledState).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);

    // Second crawl: /a unchanged (skipped), /b changed (replaced), /c new (imported).
    const second = await syncCrawledPages(
      {
        pages: [
          { content: "alpha", sourceUrl: "https://example.com/a", title: "A" },
          { content: "beta v2", sourceUrl: "https://example.com/b", title: "B" },
          { content: "gamma", sourceUrl: "https://example.com/c", title: "C" },
        ],
        source: webSource({ crawled: first.crawledState }),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: materializer },
    );

    expect(second.skipped).toBe(1);
    expect(second.imported).toHaveLength(1);
    expect(second.failed).toEqual([
      expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" }),
    ]);
    expect(second.replaced).toBe(0);
    // Both the unchanged /a and changed /b keep their prior documents; new /c is imported.
    expect(second.crawledState["https://example.com/a"]).toEqual(
      first.crawledState["https://example.com/a"],
    );
    expect(second.crawledState["https://example.com/b"]).toEqual(
      first.crawledState["https://example.com/b"],
    );
    expect(second.crawledState["https://example.com/c"]?.documentAssetId).toBeDefined();
    expect(materializer.batches).toEqual([2, 1]);
  });

  it("forwards the source permission scope to materialization", async () => {
    const materializer = fakeMaterializer();

    await syncCrawledPages(
      {
        pages: [{ content: "private", sourceUrl: "https://example.com/private" }],
        source: webSource({}, ["team:security"]),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: materializer },
    );

    expect(materializer.calls[0]?.permissionScope).toEqual(["team:security"]);
  });

  it("fails changed pages closed without materializing replacement bytes", async () => {
    const materializer = fakeMaterializer();
    const first = await syncCrawledPages(
      {
        pages: [{ content: "alpha", sourceUrl: "https://example.com/a" }],
        source: webSource(),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: materializer },
    );

    const changed = await syncCrawledPages(
      {
        pages: [{ content: "alpha v2", sourceUrl: "https://example.com/a" }],
        source: webSource({ crawled: first.crawledState }),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: materializer },
    );
    expect(changed.imported).toEqual([]);
    expect(changed.failed).toEqual([
      expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" }),
    ]);
    expect(changed.crawledState).toEqual(first.crawledState);
    expect(materializer.batches).toEqual([1]);
  });

  it("gives colliding titles distinct filenames via the content-hash suffix", async () => {
    const hashOne = await sha256Hex(textEncoder.encode("one"));
    const hashTwo = await sha256Hex(textEncoder.encode("two"));
    const pageOne = { content: "one", sourceUrl: "https://example.com/1", title: "Guide" };
    const pageTwo = { content: "two", sourceUrl: "https://example.com/2", title: "Guide" };

    expect(crawledPageFilename(pageOne, hashOne)).not.toBe(crawledPageFilename(pageTwo, hashTwo));
    expect(crawledPageFilename(pageOne, hashOne)).toBe(`Guide-${hashOne.slice(0, 8)}.md`);
  });

  it("reads only well-formed crawled state entries", () => {
    expect(
      readCrawledState({
        crawled: {
          bad: { documentAssetId: 42 },
          good: { documentAssetId: "doc-1", sha256: "a".repeat(64) },
        },
      }),
    ).toEqual({ good: { documentAssetId: "doc-1", sha256: "a".repeat(64) } });
    expect(readCrawledState({})).toEqual({});
  });

  it("skips state folding for failed materializations and falls back to the page filename base", async () => {
    // Materializer drops every document (all failed) -> nothing folds into state.
    const dropping = {
      materialize: async () => ({
        documents: [],
        failed: [
          { code: "SOURCE_DOCUMENT_MATERIALIZATION_FAILED", error: "failed", filename: "x" },
        ],
      }),
    } as unknown as SourceDocumentMaterializer;
    const result = await syncCrawledPages(
      {
        pages: [{ content: "alpha", sourceUrl: "https://example.com/a" }],
        source: webSource(),
        tenantId: "tenant-1",
      },
      { sourceDocumentMaterializer: dropping },
    );
    expect(result.imported).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.crawledState).toEqual({});

    // A URL that slugs to nothing falls back to the "page" base.
    const hash = await sha256Hex(textEncoder.encode("body"));
    expect(crawledPageFilename({ content: "body", sourceUrl: "https://///" }, hash)).toBe(
      `page-${hash.slice(0, 8)}.md`,
    );
  });
});
