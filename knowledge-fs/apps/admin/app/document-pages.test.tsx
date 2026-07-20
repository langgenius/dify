import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import DocumentStatusPage from "./documents/[spaceId]/[documentId]/page";
import ParseArtifactPage from "./documents/[spaceId]/[documentId]/parse-artifacts/[version]/page";
import DocumentListPage from "./documents/[spaceId]/page";

describe("Admin document read pages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders tenant-scoped document status from the API", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      expect(request.headers.get("authorization")).toBe("Bearer dev-token");

      if (request.url === "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1") {
        return Response.json({
          createdAt: "2026-05-21T00:00:00.000Z",
          filename: "roadmap.md",
          id: "asset-1",
          knowledgeSpaceId: "space-1",
          metadata: { traceId: "trace-1" },
          mimeType: "text/markdown",
          objectKey: "tenant/spaces/space-1/documents/asset-1/roadmap.md",
          parserStatus: "parsed",
          sha256: "b".repeat(64),
          sizeBytes: 2048,
          version: 1,
        });
      }

      if (
        request.url === "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/outline"
      ) {
        return Response.json({
          artifactHash: "c".repeat(64),
          createdAt: "2026-06-22T00:00:00.000Z",
          documentAssetId: "asset-1",
          id: "outline-1",
          knowledgeSpaceId: "space-1",
          metadata: {
            quality: {
              fallbackNodeCount: 0,
              headingCoverageRatio: 1,
              titleLocationCoverageRatio: 1,
            },
          },
          nodes: [
            {
              childNodeIds: ["outline-child"],
              children: [
                {
                  childNodeIds: [],
                  children: [],
                  endOffset: 180,
                  endPage: 2,
                  id: "outline-child",
                  level: 2,
                  metadata: {},
                  sectionPath: ["Guide", "Refunds"],
                  sourceElementIds: ["element-2"],
                  sourceNodeIds: [],
                  startOffset: 20,
                  startPage: 2,
                  summary: "Refund approval summary.",
                  title: "Refunds",
                  titleLocation: {
                    confidence: 1,
                    pageNumber: 2,
                    source: "parser-heading",
                    startOffset: 20,
                  },
                  tocSource: "parser-heading",
                },
              ],
              id: "outline-root",
              level: 1,
              metadata: {},
              sectionPath: ["Guide"],
              sourceElementIds: ["element-1"],
              sourceNodeIds: [],
              startPage: 1,
              summary: "Guide summary.",
              title: "Guide",
              tocSource: "parser-heading",
            },
          ],
          outlineVersion: "document-outline-v1",
          parseArtifactId: "artifact-1",
          version: 1,
        });
      }

      if (
        request.url ===
        "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/multimodal"
      ) {
        return Response.json({
          artifactHash: "c".repeat(64),
          createdAt: "2026-06-22T00:00:00.000Z",
          documentAssetId: "asset-1",
          id: "manifest-1",
          items: [
            {
              assetRef: {
                contentType: "image/png",
                objectKey: "tenant/spaces/space-1/documents/asset-1/assets/chart.png",
                sha256: "a".repeat(64),
                variants: {
                  thumbnail: {
                    contentType: "image/png",
                    objectKey: "tenant/spaces/space-1/documents/asset-1/assets/chart-thumbnail.png",
                    sha256: "d".repeat(64),
                  },
                },
              },
              boundingBox: { height: 120, width: 240, x: 10, y: 20 },
              caption: "Renewal trend chart",
              endOffset: 180,
              enrichment: {
                asset: "provided",
                caption: "provided",
                ocr: "provided",
                tableStructure: "unsupported",
                visualEmbedding: "missing",
              },
              id: "item-1",
              modality: "image",
              ocrText: "Q1 renewals increased 12%",
              pageNumber: 3,
              parseElementId: "element-image-1",
              sectionPath: ["Guide", "Charts"],
              sourceMetadata: {
                enrichment: {
                  provider: "metadata",
                  status: "provided",
                  task: "image",
                },
              },
              startOffset: 120,
              textPreview: "Q1 renewals increased 12%",
              title: "Renewal trend chart",
            },
            {
              endOffset: 520,
              enrichment: {
                asset: "missing",
                caption: "missing",
                ocr: "missing",
                tableStructure: "missing",
                visualEmbedding: "missing",
              },
              id: "item-2",
              modality: "table",
              pageNumber: 4,
              parseElementId: "element-table-1",
              sectionPath: ["Guide", "Tables"],
              sourceMetadata: {
                enrichment: {
                  error: "provider quota exceeded",
                  provider: "failing-understanding",
                  status: "failed",
                  task: "table",
                },
              },
              startOffset: 400,
              textPreview: "Renewal table pending understanding.",
              title: "Renewal table",
            },
          ],
          knowledgeSpaceId: "space-1",
          manifestVersion: "document-multimodal-manifest-v1",
          metadata: {
            enrichment: {
              attemptedItems: 2,
              failedItems: 1,
              model: "vision-model",
              providerBudget: { maxItems: 2, maxSourceTextChars: 100 },
              skippedItems: 1,
              source: "provider",
            },
            modalityCounts: { code: 0, image: 1, page: 0, table: 1 },
          },
          parseArtifactId: "artifact-1",
          version: 1,
        });
      }

      if (
        request.url ===
        "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/multimodal/item-1/asset?variant=thumbnail"
      ) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png", "x-document-multimodal-item-id": "item-1" },
        });
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(
      await DocumentStatusPage({
        params: Promise.resolve({ documentId: "asset-1", spaceId: "space-1" }),
      }),
    );

    expect(html).toContain("Document status");
    expect(html).toContain("roadmap.md");
    expect(html).toContain("parsed");
    expect(html).toContain("2.0 KiB");
    expect(html).toContain("bbbbbbbbbbbb");
    expect(html).toContain("/documents/space-1/asset-1/parse-artifacts/1");
    expect(html).toContain("Document outline");
    expect(html).toContain("Guide / Refunds");
    expect(html).toContain("Refund approval summary.");
    expect(html).toContain("Page 2");
    expect(html).toContain("Offset 20-180");
    expect(html).toContain("0 fallback | 100% headings | 100% titles");
    expect(html).toContain("Multimodal manifest");
    expect(html).toContain("table:1 | image:1 | code:0 | page:0");
    expect(html).toContain("provider | vision-model | 2 attempted | 1 skipped | 1 failed");
    expect(html).toContain("budget 2 items / 100 chars");
    expect(html).toContain("Page 3 / Guide / Charts");
    expect(html).toContain("image:1");
    expect(html).toContain("Renewal trend chart");
    expect(html).toContain("image | Guide / Charts | element-image-1");
    expect(html).toContain("Offset 120-180");
    expect(html).toContain("Bbox x:10 y:20 w:240 h:120");
    expect(html).toContain("Provider provided (metadata) image");
    expect(html).toContain("Page 4 / Guide / Tables");
    expect(html).toContain("table:1");
    expect(html).toContain("Renewal table");
    expect(html).toContain(
      "Provider failed (failing-understanding) table: provider quota exceeded",
    );
    expect(html).toContain(
      "asset:provided | caption:provided | ocr:provided | visualEmbedding:missing",
    );
    expect(html).toContain("Asset ready");
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html).toContain("/knowledge-spaces/space-1/documents/asset-1/multimodal/item-1/asset");
    expect(html).toContain(
      "/knowledge-spaces/space-1/documents/asset-1/multimodal/item-1/asset?variant=thumbnail",
    );
    expect(requests.map((request) => request.url).sort()).toEqual([
      "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1",
      "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/multimodal",
      "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/multimodal/item-1/asset?variant=thumbnail",
      "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/outline",
    ]);
  });

  it("renders a tenant-scoped document list from the KnowledgeFS document view", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      expect(request.url).toBe(
        "http://localhost:8788/knowledge-spaces/space-1/documents?limit=50&cursor=page-2",
      );
      expect(request.headers.get("authorization")).toBe("Bearer dev-token");

      return Response.json({
        items: [
          {
            createdAt: "2026-05-21T00:00:00.000Z",
            filename: "roadmap.md",
            id: "asset-1",
            knowledgeSpaceId: "space-1",
            metadata: {},
            mimeType: "text/markdown",
            objectKey: "tenant/spaces/space-1/documents/asset-1/roadmap.md",
            parserStatus: "parsed",
            sha256: "b".repeat(64),
            sizeBytes: 2048,
            version: 1,
          },
        ],
      });
    });

    const html = renderToStaticMarkup(
      await DocumentListPage({
        params: Promise.resolve({ spaceId: "space-1" }),
        searchParams: Promise.resolve({ cursor: "page-2" }),
      }),
    );

    expect(html).toContain("Documents");
    expect(html).toContain("Document list");
    expect(html).toContain("roadmap.md");
    expect(html).toContain("tenant/spaces/space-1/documents/asset-1/roadmap.md");
    expect(html).toContain("/documents/space-1/asset-1");
    expect(requests).toHaveLength(1);
  });

  it("renders parse artifact elements from the API", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.url).toBe(
        "http://localhost:8788/knowledge-spaces/space-1/documents/asset-1/parse-artifacts/1",
      );
      expect(request.headers.get("authorization")).toBe("Bearer dev-token");

      return Response.json({
        artifactHash: "c".repeat(64),
        contentType: "text",
        createdAt: "2026-05-21T00:00:00.000Z",
        documentAssetId: "asset-1",
        elements: [
          {
            id: "element-1",
            metadata: {},
            sectionPath: ["Intro"],
            text: "Hello roadmap",
            type: "paragraph",
          },
        ],
        id: "artifact-1",
        metadata: { traceId: "trace-1" },
        parser: "native-markdown",
        version: 1,
      });
    });

    const html = renderToStaticMarkup(
      await ParseArtifactPage({
        params: Promise.resolve({ documentId: "asset-1", spaceId: "space-1", version: "1" }),
      }),
    );

    expect(html).toContain("Parse artifact");
    expect(html).toContain("native-markdown");
    expect(html).toContain("artifact-1");
    expect(html).toContain("Hello roadmap");
    expect(html).toContain("Intro");
    expect(html).toContain("cccccccccccc");
  });
});
