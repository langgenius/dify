import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentPdfRasterizer,
  DocumentPdfRenderError,
  type RenderDocumentPdfPageRequest,
  awaitUncancellablePdfRasterOperation,
  createPopplerPdfRasterizer,
  normalizePdfRasterBoundingBoxForDpi,
  rasterizeDocumentPdfMultimodalAssets,
} from "./document-pdf-rasterizer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const documentBody = new TextEncoder().encode("%PDF-1.7\n");

interface FakePopplerCommand {
  readonly cleanup: () => Promise<void>;
  readonly command: string;
  readonly pdfInfoCommand: string;
  readonly readInvocations: () => Promise<readonly string[][]>;
  readonly readPdfInfoInvocations: () => Promise<readonly string[][]>;
  readonly readWorkDirs: () => Promise<readonly string[]>;
}

async function createFakePopplerCommand(
  mode: "failure" | "success" | "timeout" = "success",
): Promise<FakePopplerCommand> {
  const root = await mkdtemp(join(tmpdir(), "knowledge-fs-fake-poppler-"));
  const command = join(root, "pdftoppm.cjs");
  const invocationLog = join(root, "invocations.ndjson");
  const pdfInfoInvocationLog = join(root, "pdfinfo-invocations.ndjson");
  const workDirLog = join(root, "workdirs.txt");
  const sharp = (await import("sharp")).default;
  const pagePng = await sharp({
    create: {
      background: { alpha: 1, b: 255, g: 127, r: 63 },
      channels: 4,
      height: 80,
      width: 100,
    },
  })
    .png()
    .toBuffer();
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("-box")) {
  fs.appendFileSync(${JSON.stringify(pdfInfoInvocationLog)}, JSON.stringify(args) + "\\n");
  fs.appendFileSync(${JSON.stringify(workDirLog)}, path.dirname(args.at(-1)) + "\\n");
  const pageNumber = args[args.indexOf("-f") + 1];
  process.stdout.write("Page " + pageNumber + " size: 612 x 792 pts\\n");
  process.exit(0);
}
const inputPath = args.at(-2);
const outputPrefix = args.at(-1);
const pageNumber = args[args.indexOf("-f") + 1];
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(args) + "\\n");
fs.appendFileSync(${JSON.stringify(workDirLog)}, path.dirname(inputPath) + "\\n");
if (${JSON.stringify(mode)} === "timeout") {
  setTimeout(() => {}, 10_000);
} else if (${JSON.stringify(mode)} === "failure") {
  process.stderr.write("fake pdftoppm failure");
  process.exitCode = 7;
} else {
  fs.writeFileSync(outputPrefix + "-" + pageNumber + ".png", Buffer.from(${JSON.stringify(pagePng.toString("base64"))}, "base64"));
}
`;
  await writeFile(command, script);
  await chmod(command, 0o755);

  const readLines = async (path: string): Promise<readonly string[]> => {
    try {
      return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  };

  return {
    cleanup: async () => rm(root, { force: true, recursive: true }),
    command,
    pdfInfoCommand: command,
    readInvocations: async () =>
      (await readLines(invocationLog)).map((line) => JSON.parse(line) as string[]),
    readPdfInfoInvocations: async () =>
      (await readLines(pdfInfoInvocationLog)).map((line) => JSON.parse(line) as string[]),
    readWorkDirs: async () => readLines(workDirLog),
  };
}

async function expectTemporaryDirectoriesRemoved(paths: readonly string[]): Promise<void> {
  expect(paths.length).toBeGreaterThan(0);

  for (const path of new Set(paths)) {
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

describe("rasterizeDocumentPdfMultimodalAssets", () => {
  it("stores rasterized PDF image crops and rewrites asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const rasterizer: DocumentPdfRasterizer = {
      render: async (input) => {
        calls.push(input);

        return {
          body: new Uint8Array([1, 2, 3, 4]),
          contentType: "image/png",
          metadata: { renderer: "test" },
          variants: {
            thumbnail: {
              body: new Uint8Array([9, 9, 9]),
              contentType: "image/png",
              height: 90,
              width: 120,
            },
          },
        };
      },
    };

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: {
              boundingBox: { height: 40, width: 30, x: 10, y: 20 },
              boundingBoxCoordinateSystem: "pdf-point",
              caption: "PDF diagram",
            },
            pageNumber: 2,
            sectionPath: ["Architecture"],
            text: "PDF diagram",
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer,
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 40, width: 30, x: 10, y: 20 },
        boundingBoxGeometry: { coordinateSystem: "pdf-point" },
        documentBody,
        elementId: "figure-1",
        pageNumber: 2,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.metadata).toMatchObject({
      pdfRasterAssets: {
        rasterizedCount: 1,
        source: "pdf-raster",
      },
    });
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(
          /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43\/assets\/figure-1-[a-f0-9]{12}\.png$/u,
        ),
        sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        source: "pdf-raster",
        variants: {
          thumbnail: {
            contentType: "image/png",
            height: 90,
            objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            width: 120,
          },
        },
      },
      pdfRaster: {
        boundingBox: { height: 40, width: 30, x: 10, y: 20 },
        contentType: "image/png",
        geometry: { coordinateSystem: "pdf-point" },
        pageNumber: 2,
        renderer: { renderer: "test" },
        variants: {
          thumbnail: {
            objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
          },
        },
      },
    });
    const variants = (
      result.artifact.elements[0]?.metadata.assetRef as Readonly<Record<string, unknown>>
    ).variants as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    await expect(
      adapter.objectStorage.getObject(
        String(
          (
            result.artifact.elements[0]?.metadata.assetRef as
              | Readonly<Record<string, unknown>>
              | undefined
          )?.objectKey,
        ),
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(
      adapter.objectStorage.getObject(String(variants.thumbnail?.objectKey)),
    ).resolves.toEqual(new Uint8Array([9, 9, 9]));
  });

  it("can rasterize page-break elements as full-page previews", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "page-3",
            metadata: {},
            pageNumber: 3,
            sectionPath: [],
            type: "page-break",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => ({
          body: new Uint8Array([5, 6, 7, input.pageNumber]),
          contentType: "image/png",
        }),
      },
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(/page-3-[a-f0-9]{12}\.png$/u),
        source: "pdf-raster",
      },
      pdfRaster: {
        pageNumber: 3,
      },
    });
  });

  it("infers parser-specific bbox aliases and page geometry", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "chart-1",
            metadata: {
              bbox: { h: 0.25, left: 0.1, top: 0.2, unit: "normalized", w: 0.5 },
              caption: "Quarterly revenue chart",
              page: { height: 792, width: 612 },
              sourceDpi: 72,
            },
            pageNumber: 4,
            sectionPath: ["Financials"],
            text: "Revenue chart",
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => {
          calls.push(input);

          return {
            body: new Uint8Array([4, 3, 2, 1]),
            contentType: "image/png",
          };
        },
      },
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        boundingBoxGeometry: {
          coordinateSystem: "relative",
          pageHeight: 792,
          pageWidth: 612,
          sourceDpi: 72,
        },
        elementId: "chart-1",
        pageNumber: 4,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        cropKind: "chart",
      },
      pdfRaster: {
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        cropKind: "chart",
        geometry: {
          coordinateSystem: "relative",
          pageHeight: 792,
          pageWidth: 612,
          sourceDpi: 72,
        },
        pageNumber: 4,
      },
    });
  });

  it("recognizes Unstructured PixelSpace page geometry", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];

    await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-pixel-space",
            metadata: {
              coordinates: {
                layout_height: 800,
                layout_width: 1_000,
                system: "PixelSpace",
                x1: 100,
                x2: 400,
                y1: 200,
                y2: 600,
              },
            },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => {
          calls.push(input);
          return { body: new Uint8Array([1, 2, 3]), contentType: "image/png" };
        },
      },
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 400, width: 300, x: 100, y: 200 },
        boundingBoxGeometry: {
          coordinateSystem: "pixel",
          pageHeight: 800,
          pageWidth: 1_000,
        },
      }),
    ]);
  });

  it("rasterizes table elements as table-specific visual crops", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "table-1",
            metadata: {
              boundingBox: { height: 120, width: 320, x: 24, y: 48 },
              title: "Renewal amounts",
            },
            pageNumber: 5,
            sectionPath: ["Financials"],
            text: "Vendor | Amount",
            type: "table",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => {
          calls.push(input);

          return {
            body: new Uint8Array([8, 8, 8]),
            contentType: "image/png",
          };
        },
      },
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 120, width: 320, x: 24, y: 48 },
        elementId: "table-1",
        pageNumber: 5,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        cropKind: "table",
        objectKey: expect.stringMatching(/table-1-[a-f0-9]{12}\.png$/u),
        source: "pdf-raster",
      },
      pdfRaster: {
        cropKind: "table",
        pageNumber: 5,
      },
    });
  });

  it("skips non-PDF documents, missing PDF candidates, and existing asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    let calls = 0;

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: {
              assetRef: { uri: "data:image/png;base64,AQID" },
              boundingBox: { height: 1, width: 1, x: 0, y: 0 },
            },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "text/markdown",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async () => {
          calls += 1;

          return null;
        },
      },
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(0);
    expect(result.artifact.elements[1]?.metadata).toMatchObject({
      assetRef: { uri: "data:image/png;base64,AQID" },
    });
    expect(calls).toBe(0);
  });

  it("rejects documents that exceed the rasterized asset count limit", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    await expect(
      rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact({
          elements: [
            {
              id: "figure-1",
              metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
            {
              id: "figure-2",
              metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
          ],
        }),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        maxRasterizedAssets: 1,
        objectStorage: adapter.objectStorage,
        rasterizer: {
          render: async () => ({
            body: new Uint8Array([1]),
            contentType: "image/png",
          }),
        },
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document PDF rasterized asset count exceeds maxRasterizedAssets=1");
  });

  it("reports unresolved PDF candidates when no rasterizer is configured", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const input = artifact({
      elements: [
        {
          id: "figure-1",
          metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
      ],
    });

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: input,
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      artifact: input,
      candidateCount: 1,
      rasterizedCount: 0,
      unresolvedCount: 1,
    });
  });

  it("counts null render results as unresolved candidates", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    let renderCount = 0;

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { boundingBox: { height: 10, width: 10, x: 20, y: 20 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async () => {
          renderCount += 1;
          return renderCount === 1
            ? { body: new Uint8Array([1, 2, 3]), contentType: "image/png" }
            : null;
        },
      },
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      rasterizedCount: 0,
      unresolvedCount: 2,
    });
    expect(result.artifact.elements[0]?.metadata).not.toHaveProperty("assetRef");
    expect(result.artifact.elements[1]?.metadata).not.toHaveProperty("assetRef");
  });

  it("compensates prior pages when a later image is unresolved", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const storedKeys: string[] = [];
    const deletedKeys: string[] = [];

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 2,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async (key) => {
          deletedKeys.push(key);
          await adapter.objectStorage.deleteObject(key);
        },
        putObject: async (input) => {
          storedKeys.push(input.key);
          return adapter.objectStorage.putObject(input);
        },
      },
      rasterizer: {
        render: async ({ pageNumber }) =>
          pageNumber === 1 ? { body: new Uint8Array([1, 2, 3]), contentType: "image/png" } : null,
      },
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      rasterizedCount: 0,
      unresolvedCount: 2,
    });
    expect(result.artifact.elements.every((element) => !element.metadata.assetRef)).toBe(true);
    expect(storedKeys).toHaveLength(1);
    expect(deletedKeys).toEqual(storedKeys);
  });

  it("finishes rendering before object storage and preserves the render error cause", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const renderFailure = new Error("second crop failed");
    let renderCount = 0;
    let putCount = 0;

    const promise = rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { boundingBox: { height: 10, width: 10, x: 20, y: 20 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: {
        ...adapter.objectStorage,
        putObject: async (input) => {
          putCount += 1;
          return adapter.objectStorage.putObject(input);
        },
      },
      rasterizer: {
        render: async () => {
          renderCount += 1;

          if (renderCount === 2) {
            throw renderFailure;
          }

          return { body: new Uint8Array([1, 2, 3]), contentType: "image/png" };
        },
      },
      tenantId: "tenant-1",
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentPdfRenderError);
    expect((error as DocumentPdfRenderError).cause).toBe(renderFailure);
    expect(renderCount).toBe(2);
    expect(putCount).toBe(0);
  });

  it("renders one page at a time and compensates earlier pages after a later render failure", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const renderFailure = new Error("page 2 failed");
    const batches: number[][] = [];
    const storedKeys: string[] = [];
    const deletedKeys: string[] = [];
    const promise = rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1a",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-1b",
            metadata: { boundingBox: { height: 10, width: 10, x: 20, y: 20 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 2,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async (key) => {
          deletedKeys.push(key);
          await adapter.objectStorage.deleteObject(key);
        },
        putObject: async (input) => {
          storedKeys.push(input.key);
          return adapter.objectStorage.putObject(input);
        },
      },
      rasterizer: {
        render: async () => {
          throw new Error("single render should not be used");
        },
        renderBatch: async ({ requests }) => {
          batches.push(requests.map(({ pageNumber }) => pageNumber));

          if (requests[0]?.pageNumber === 2) {
            throw renderFailure;
          }

          return requests.map((_, index) => ({
            body: new Uint8Array([index + 1]),
            contentType: "image/png" as const,
          }));
        },
      },
      tenantId: "tenant-1",
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentPdfRenderError);
    expect((error as DocumentPdfRenderError).cause).toBe(renderFailure);
    expect(batches).toEqual([[1, 1], [2]]);
    expect(storedKeys).toHaveLength(2);
    expect(deletedKeys).toEqual([...storedKeys].reverse());

    for (const key of storedKeys) {
      await expect(adapter.objectStorage.headObject(key)).resolves.toBeNull();
    }
  });

  it("does not expose a fallback-safe render error when compensation fails", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const renderFailure = new Error("page 2 failed");
    let deleteCount = 0;
    const promise = rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 2,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async () => {
          deleteCount += 1;
          throw Object.assign(new Error("cleanup failed"), { retryable: true });
        },
      },
      rasterizer: {
        render: async ({ pageNumber }) => {
          if (pageNumber === 2) {
            throw renderFailure;
          }

          return { body: new Uint8Array([1]), contentType: "image/png" };
        },
      },
      tenantId: "tenant-1",
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).not.toBeInstanceOf(DocumentPdfRenderError);
    expect((error as AggregateError).cause).toBeInstanceOf(DocumentPdfRenderError);
    expect(error).toMatchObject({ retryable: true });
    expect(deleteCount).toBe(1);
  });

  it("materializes one Poppler document while rendering and storing distinct pages incrementally", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const adapter = createNodePlatformAdapter({ env: {} });
      const filesDuringPersistence: string[][] = [];
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        dpi: 144,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 48,
      });
      const result = await rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact({
          elements: [
            {
              id: "page-1",
              metadata: {},
              pageNumber: 1,
              sectionPath: [],
              type: "page-break",
            },
            {
              id: "figure-1",
              metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
            {
              id: "page-2",
              metadata: {},
              pageNumber: 2,
              sectionPath: [],
              type: "page-break",
            },
          ],
        }),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        objectStorage: {
          ...adapter.objectStorage,
          putObject: async (input) => {
            const workDir = (await fakePoppler.readWorkDirs()).at(-1);

            if (!workDir) {
              throw new Error("Poppler did not report its work directory before persistence");
            }
            filesDuringPersistence.push(await readdir(workDir));
            return adapter.objectStorage.putObject(input);
          },
        },
        rasterizer,
        tenantId: "tenant-1",
      });

      expect(result).toMatchObject({ candidateCount: 3, rasterizedCount: 3, unresolvedCount: 0 });
      expect(
        (await fakePoppler.readPdfInfoInvocations()).map((args) => args[args.indexOf("-f") + 1]),
      ).toEqual(["1", "2"]);
      expect(
        (await fakePoppler.readInvocations()).map((args) => ({
          dpi: args[args.indexOf("-r") + 1],
          pageNumber: args[args.indexOf("-f") + 1],
        })),
      ).toEqual([
        { dpi: "144", pageNumber: "1" },
        { dpi: "48", pageNumber: "1" },
        { dpi: "144", pageNumber: "2" },
        { dpi: "48", pageNumber: "2" },
      ]);
      expect(filesDuringPersistence).toHaveLength(6);
      expect(filesDuringPersistence.every((files) => files.join(",") === "input.pdf")).toBe(true);
      const workDirs = await fakePoppler.readWorkDirs();
      expect(new Set(workDirs).size).toBe(1);
      await expectTemporaryDirectoriesRemoved(workDirs);
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("preserves storage errors and compensates objects written before a variant failure", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const storageFailure = new Error("object storage unavailable");
    const storedKeys: string[] = [];
    const deletedKeys: string[] = [];
    let putCount = 0;
    const promise = rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async (key) => {
          deletedKeys.push(key);
          await adapter.objectStorage.deleteObject(key);
        },
        putObject: async (input) => {
          putCount += 1;

          if (putCount === 2) {
            throw storageFailure;
          }

          storedKeys.push(input.key);
          return adapter.objectStorage.putObject(input);
        },
      },
      rasterizer: {
        render: async () => ({
          body: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          variants: {
            thumbnail: {
              body: new Uint8Array([4, 5, 6]),
              contentType: "image/png",
            },
          },
        }),
      },
      tenantId: "tenant-1",
    });

    await expect(promise).rejects.toBe(storageFailure);
    expect(storedKeys).toHaveLength(1);
    expect(deletedKeys).toEqual(storedKeys);
    await expect(adapter.objectStorage.headObject(storedKeys[0] ?? "")).resolves.toBeNull();
  });

  it("validates Poppler thumbnail rasterizer options", () => {
    expect(() => createPopplerPdfRasterizer({ thumbnailDpi: 0 })).toThrow(
      "Poppler PDF rasterizer thumbnailDpi must be at least 1",
    );
    expect(() => createPopplerPdfRasterizer({ thumbnailVariantName: "" })).toThrow(
      "Poppler PDF rasterizer thumbnailVariantName must be non-empty",
    );
    expect(createPopplerPdfRasterizer({ thumbnailDpi: 32 })).toBeDefined();
  });

  it("normalizes PDF raster bounding boxes across coordinate systems", () => {
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 72, width: 144, x: 36, y: 18 },
        dpi: 144,
        geometry: { coordinateSystem: "pdf-point" },
      }),
    ).toEqual({ height: 144, width: 288, x: 72, y: 36 });
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        dpi: 144,
        geometry: { coordinateSystem: "relative", pageHeight: 792, pageWidth: 612 },
      }),
    ).toEqual({ height: 396, width: 612, x: 122.4, y: 316.8 });
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 20, width: 40, x: 10, y: 5 },
        dpi: 72,
        geometry: { coordinateSystem: "pixel", sourceDpi: 144 },
      }),
    ).toEqual({ height: 10, width: 20, x: 5, y: 2.5 });
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 72, width: 144, x: 36, y: 18 },
        dpi: 144,
        geometry: { coordinateSystem: "pdf-point", pageHeight: 792, pageWidth: 612 },
        renderedPage: { height: 1_056, width: 816 },
      }),
    ).toEqual({ height: 96, width: 192, x: 48, y: 24 });
  });

  it("caps aggregate raster output across page-sized render batches", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const storedKeys: string[] = [];
    const deletedKeys: string[] = [];
    const promise = rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [1, 2].map((pageNumber) => ({
          id: `figure-${pageNumber}`,
          metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
          pageNumber,
          sectionPath: [],
          type: "image" as const,
        })),
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      maxRasterizedBytes: 3,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async (key) => {
          deletedKeys.push(key);
        },
        headObject: async () => null,
        putObject: async (input) => {
          storedKeys.push(input.key);
          return {
            ...(input.contentType ? { contentType: input.contentType } : {}),
            key: input.key,
            metadata: input.metadata ?? {},
            sizeBytes: input.body.byteLength,
          };
        },
      },
      rasterizer: {
        render: async () => ({ body: new Uint8Array([1, 2]), contentType: "image/png" }),
      },
      tenantId: "tenant-1",
      writeOwnerId: "compilation-1",
    });

    await expect(promise).rejects.toThrow("maxRasterizedBytes=3");
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0]).toContain("/assets/compilation-1/");
    expect(deletedKeys).toEqual(storedKeys);
  });
});

describe("createPopplerPdfRasterizer batch rendering", () => {
  it("holds a bounded slot across the full caller-owned materialization phase", async () => {
    const rasterizer = createPopplerPdfRasterizer({ maxConcurrency: 2 });
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const operations = Array.from({ length: 4 }, () =>
      rasterizer.withMaterializationSlot?.(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      }),
    );

    await waitForCondition(() => releases.length === 2);
    for (const release of releases.splice(0, 2)) release();
    await waitForCondition(() => releases.length === 2);
    for (const release of releases.splice(0, 2)) release();
    await Promise.all(operations);

    expect(maxActive).toBe(2);
  });

  it("waits for uncancellable materialization work to settle before surfacing abort", async () => {
    const rasterizer = createPopplerPdfRasterizer({ maxConcurrency: 1 });
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let settled = false;
    const pending = rasterizer.withMaterializationSlot?.(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }, controller.signal);
    void pending?.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await waitForCondition(() => release !== undefined);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release?.();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(settled).toBe(true);
  });

  it("removes a cancelled materialization from the queue before it acquires a slot", async () => {
    const rasterizer = createPopplerPdfRasterizer({ maxConcurrency: 1 });
    let releaseFirst: (() => void) | undefined;
    let cancelledEntered = false;
    let cancelledSettled = false;
    let thirdEntered = false;
    const first = rasterizer.withMaterializationSlot?.(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await waitForCondition(() => releaseFirst !== undefined);
    const controller = new AbortController();
    const cancelled = rasterizer.withMaterializationSlot?.(async () => {
      cancelledEntered = true;
    }, controller.signal);
    void cancelled?.then(
      () => {
        cancelledSettled = true;
      },
      () => {
        cancelledSettled = true;
      },
    );
    controller.abort(new DOMException("cancelled while queued", "AbortError"));
    await waitForCondition(() => cancelledSettled);
    expect(cancelledEntered).toBe(false);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const third = rasterizer.withMaterializationSlot?.(async () => {
      thirdEntered = true;
    });
    expect(thirdEntered).toBe(false);
    releaseFirst?.();
    await expect(Promise.all([first, third])).resolves.toEqual([undefined, undefined]);
    expect(thirdEntered).toBe(true);
  });

  it("allows a document session inside the legacy materialization slot without deadlocking", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        maxConcurrency: 1,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });
      const withDocumentSession = rasterizer.withDocumentSession;
      const withMaterializationSlot = rasterizer.withMaterializationSlot;
      if (!withDocumentSession || !withMaterializationSlot) {
        throw new Error("Poppler rasterizer did not expose its materialization APIs");
      }

      const rendered = await withMaterializationSlot(() =>
        withDocumentSession({ documentBody }, (session) =>
          session.renderBatch({ requests: [{ elementId: "page-1", pageNumber: 1 }] }),
        ),
      );

      expect(rendered[0]?.contentType).toBe("image/png");
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("caches page sizes across batches in one document session and removes its work directory", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        dpi: 144,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 48,
      });
      if (!rasterizer.withDocumentSession) {
        throw new Error("Poppler rasterizer did not expose a document session");
      }

      await rasterizer.withDocumentSession({ documentBody }, async (session) => {
        await session.renderBatch({
          requests: [{ elementId: "page-2-first", pageNumber: 2 }],
        });
        await session.renderBatch({
          requests: [{ elementId: "page-2-second", pageNumber: 2 }],
        });
      });

      expect(
        (await fakePoppler.readPdfInfoInvocations()).map((args) => args[args.indexOf("-f") + 1]),
      ).toEqual(["2"]);
      expect(await fakePoppler.readInvocations()).toHaveLength(4);
      const workDirs = await fakePoppler.readWorkDirs();
      expect(new Set(workDirs).size).toBe(1);
      await expectTemporaryDirectoriesRemoved(workDirs);
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("preserves callback failures and cleans the document session", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });
      const callbackFailure = new Error("object persistence failed");
      if (!rasterizer.withDocumentSession) {
        throw new Error("Poppler rasterizer did not expose a document session");
      }

      const promise = rasterizer.withDocumentSession({ documentBody }, async (session) => {
        await session.renderBatch({
          requests: [{ elementId: "page-1", pageNumber: 1 }],
        });
        throw callbackFailure;
      });

      await expect(promise).rejects.toBe(callbackFailure);
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("preserves a callback failure when document session cleanup also fails", async () => {
    const fakePoppler = await createFakePopplerCommand();
    let cleanupBlocker: string | undefined;
    let workDir: string | undefined;

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });
      const callbackFailure = new Error("object persistence failed");
      if (!rasterizer.withDocumentSession) {
        throw new Error("Poppler rasterizer did not expose a document session");
      }

      const promise = rasterizer.withDocumentSession({ documentBody }, async (session) => {
        await session.renderBatch({
          requests: [{ elementId: "page-1", pageNumber: 1 }],
        });
        workDir = (await fakePoppler.readWorkDirs())[0];
        if (!workDir) {
          throw new Error("Fake Poppler did not report its work directory");
        }
        cleanupBlocker = join(workDir, "cleanup-blocker");
        await mkdir(cleanupBlocker);
        await writeFile(join(cleanupBlocker, "asset.png"), "blocked");
        await chmod(cleanupBlocker, 0);
        throw callbackFailure;
      });

      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).cause).toBe(callbackFailure);
      expect((error as AggregateError).errors).toEqual([
        callbackFailure,
        expect.objectContaining({ code: "EACCES" }),
      ]);
    } finally {
      if (cleanupBlocker) {
        await chmod(cleanupBlocker, 0o700);
      }
      if (workDir) {
        await rm(workDir, { force: true, recursive: true });
      }
      await fakePoppler.cleanup();
    }
  });

  it("surfaces an unaccompanied document session cleanup failure directly", async () => {
    const fakePoppler = await createFakePopplerCommand();
    let cleanupBlocker: string | undefined;
    let workDir: string | undefined;

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });
      if (!rasterizer.withDocumentSession) {
        throw new Error("Poppler rasterizer did not expose a document session");
      }

      const promise = rasterizer.withDocumentSession({ documentBody }, async (session) => {
        await session.renderBatch({
          requests: [{ elementId: "page-1", pageNumber: 1 }],
        });
        workDir = (await fakePoppler.readWorkDirs())[0];
        if (!workDir) {
          throw new Error("Fake Poppler did not report its work directory");
        }
        cleanupBlocker = join(workDir, "cleanup-blocker");
        await mkdir(cleanupBlocker);
        await writeFile(join(cleanupBlocker, "asset.png"), "blocked");
        await chmod(cleanupBlocker, 0);

        return "rendered";
      });

      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AggregateError);
      expect(error).toMatchObject({ code: "EACCES" });
    } finally {
      if (cleanupBlocker) {
        await chmod(cleanupBlocker, 0o700);
      }
      if (workDir) {
        await rm(workDir, { force: true, recursive: true });
      }
      await fakePoppler.cleanup();
    }
  });

  it("renders each distinct DPI once for multiple crops on the same page", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        dpi: 144,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 48,
      });
      const requests: readonly RenderDocumentPdfPageRequest[] = [
        {
          boundingBox: { height: 10.1, width: 20.4, x: 10.8, y: 5.7 },
          boundingBoxGeometry: { coordinateSystem: "pixel" },
          elementId: "figure-1",
          pageNumber: 2,
        },
        {
          boundingBox: { height: 50, width: 50, x: 90, y: 70 },
          boundingBoxGeometry: { coordinateSystem: "pixel" },
          elementId: "figure-2",
          pageNumber: 2,
        },
        {
          boundingBox: { height: 400, width: 300, x: 100, y: 200 },
          boundingBoxGeometry: {
            coordinateSystem: "pixel",
            pageHeight: 800,
            pageWidth: 1_000,
            sourceDpi: 300,
          },
          elementId: "pixel-space",
          pageNumber: 2,
        },
        {
          boundingBox: { height: 0.5, width: 0.3, x: 0.1, y: 0.25 },
          boundingBoxGeometry: {
            coordinateSystem: "relative",
            pageHeight: 8_000,
            pageWidth: 10_000,
          },
          elementId: "relative-space",
          pageNumber: 2,
        },
        {
          boundingBox: { height: 10, width: 10, x: 200, y: 200 },
          boundingBoxGeometry: { coordinateSystem: "pixel" },
          elementId: "outside-page",
          pageNumber: 2,
        },
      ];

      const rendered = await rasterizer.renderBatch?.({ documentBody, requests });
      expect(rendered).toHaveLength(5);

      const invocations = await fakePoppler.readInvocations();
      expect(
        invocations.map((args) => ({
          dpi: args[args.indexOf("-r") + 1],
          pageNumber: args[args.indexOf("-f") + 1],
          scaleTo: args.includes("-scale-to") ? args[args.indexOf("-scale-to") + 1] : undefined,
        })),
      ).toEqual([
        { dpi: "144", pageNumber: "2", scaleTo: undefined },
        { dpi: "48", pageNumber: "2", scaleTo: undefined },
      ]);
      expect(invocations.every((args) => !args.includes("-x") && !args.includes("-W"))).toBe(true);

      const sharp = (await import("sharp")).default;
      await expect(sharp(rendered?.[0]?.body).metadata()).resolves.toMatchObject({
        height: 11,
        width: 22,
      });
      await expect(sharp(rendered?.[1]?.body).metadata()).resolves.toMatchObject({
        height: 10,
        width: 10,
      });
      await expect(sharp(rendered?.[2]?.body).metadata()).resolves.toMatchObject({
        height: 40,
        width: 30,
      });
      expect(rendered?.[2]?.metadata).toMatchObject({
        crop: {
          normalizedBoundingBox: { height: 40, width: 30, x: 10, y: 20 },
        },
      });
      await expect(sharp(rendered?.[3]?.body).metadata()).resolves.toMatchObject({
        height: 40,
        width: 30,
      });
      expect(rendered?.[3]?.metadata).toMatchObject({
        crop: {
          normalizedBoundingBox: { height: 40, width: 30, x: 10, y: 20 },
        },
      });
      expect(rendered?.[4]).toBeNull();
      expect(rendered?.[0]?.metadata).toMatchObject({
        command: fakePoppler.command,
        crop: {
          boundingBox: { height: 10.1, width: 20.4, x: 10.8, y: 5.7 },
          geometry: { coordinateSystem: "pixel" },
          normalizedBoundingBox: { height: 10.1, width: 20.4, x: 10.8, y: 5.7 },
        },
        dpi: 144,
        elementId: "figure-1",
        pageNumber: 2,
        thumbnailDpi: 48,
      });
      expect(rendered?.[0]?.variants?.thumbnail?.metadata).toMatchObject({
        dpi: 48,
        elementId: "figure-1",
        pageNumber: 2,
        variant: "thumbnail",
      });
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("renders separate pages independently while preserving batch result order", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        dpi: 144,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 48,
      });
      const requests: readonly RenderDocumentPdfPageRequest[] = [
        { elementId: "page-4", pageNumber: 4 },
        {
          boundingBox: { height: 5, width: 6, x: 1, y: 2 },
          elementId: "figure-2",
          pageNumber: 2,
        },
        {
          boundingBox: { height: 7, width: 8, x: 3, y: 4 },
          elementId: "figure-4",
          pageNumber: 4,
        },
      ];

      const rendered = await rasterizer.renderBatch?.({ documentBody, requests });
      expect(rendered?.map((image) => image?.metadata?.elementId)).toEqual([
        "page-4",
        "figure-2",
        "figure-4",
      ]);
      expect(
        (await fakePoppler.readInvocations()).map((args) => ({
          dpi: args[args.indexOf("-r") + 1],
          pageNumber: args[args.indexOf("-f") + 1],
        })),
      ).toEqual([
        { dpi: "144", pageNumber: "4" },
        { dpi: "48", pageNumber: "4" },
        { dpi: "144", pageNumber: "2" },
        { dpi: "48", pageNumber: "2" },
      ]);
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("reuses the page render when the main and thumbnail DPI match", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        dpi: 96,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 96,
      });

      const rendered = await rasterizer.renderBatch?.({
        documentBody,
        requests: [
          {
            boundingBox: { height: 10, width: 10, x: 0, y: 0 },
            elementId: "figure-1",
            pageNumber: 1,
          },
        ],
      });

      expect(rendered?.[0]?.variants?.thumbnail).toBeDefined();
      expect(await fakePoppler.readInvocations()).toHaveLength(1);
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("only applies proportional page caps when the natural render would exceed them", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        maxPageDimension: 1_000,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });

      await rasterizer.render({ documentBody, elementId: "page-1", pageNumber: 1 });
      expect(
        (await fakePoppler.readInvocations()).map((args) =>
          args.includes("-scale-to") ? args[args.indexOf("-scale-to") + 1] : undefined,
        ),
      ).toEqual(["1000", "333"]);
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("rejects encoded Poppler pages before reading oversized output files", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        maxEncodedPageBytes: 1,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });

      await expect(
        rasterizer.render({ documentBody, elementId: "page-1", pageNumber: 1 }),
      ).rejects.toThrow("maxEncodedPageBytes=1");
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("caps aggregate encoded crop and variant bytes for one batch", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        maxEncodedCropBytes: 1,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 144,
      });

      await expect(
        rasterizer.renderBatch?.({
          documentBody,
          requests: [
            {
              boundingBox: { height: 10, width: 10, x: 0, y: 0 },
              elementId: "figure-1",
              pageNumber: 1,
            },
          ],
        }),
      ).rejects.toThrow("maxEncodedCropBytes=1");
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("refuses to guess absolute crop coordinates when page scaling lacks source dimensions", async () => {
    const fakePoppler = await createFakePopplerCommand();

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        maxPageDimension: 100,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        thumbnailDpi: 144,
      });

      await expect(
        rasterizer.render({
          boundingBox: { height: 10, width: 10, x: 0, y: 0 },
          boundingBoxGeometry: { coordinateSystem: "pdf-point" },
          documentBody,
          elementId: "figure-1",
          pageNumber: 1,
        }),
      ).rejects.toThrow("cannot normalize coordinates after page dimension capping");
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("waits for an uncancellable image operation to settle before reporting abort", async () => {
    const controller = new AbortController();
    let settleOperation: ((value: string) => void) | undefined;
    const operation = new Promise<string>((resolve) => {
      settleOperation = resolve;
    });
    let helperSettled = false;
    const result = awaitUncancellablePdfRasterOperation(operation, controller.signal);
    void result.then(
      () => {
        helperSettled = true;
      },
      () => {
        helperSettled = true;
      },
    );

    controller.abort(new DOMException("cancelled", "AbortError"));
    await Promise.resolve();
    expect(helperSettled).toBe(false);

    settleOperation?.("done");
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(helperSettled).toBe(true);
  });

  it("wraps Poppler failures and removes the shared temporary directory", async () => {
    const fakePoppler = await createFakePopplerCommand("failure");

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
      });
      const promise = rasterizer.render({
        documentBody,
        elementId: "figure-1",
        pageNumber: 1,
      });
      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DocumentPdfRenderError);
      expect((error as DocumentPdfRenderError).cause).toBeInstanceOf(Error);
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("honors Poppler timeouts and removes the shared temporary directory", async () => {
    const fakePoppler = await createFakePopplerCommand("timeout");

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        timeoutMs: 1_000,
      });
      const promise = rasterizer.render({
        documentBody,
        elementId: "figure-1",
        pageNumber: 1,
      });
      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DocumentPdfRenderError);
      expect((error as DocumentPdfRenderError).cause).toBeInstanceOf(Error);
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("classifies caller cancellation as an abort instead of a render fallback", async () => {
    const fakePoppler = await createFakePopplerCommand("timeout");

    try {
      const controller = new AbortController();
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        timeoutMs: 5_000,
      });
      const adapter = createNodePlatformAdapter({ env: {} });
      const promise = rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact({
          elements: [
            {
              id: "figure-1",
              metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
          ],
        }),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        objectStorage: adapter.objectStorage,
        rasterizer,
        signal: controller.signal,
        tenantId: "tenant-1",
      });
      await waitForCondition(async () => (await fakePoppler.readInvocations()).length > 0);
      controller.abort(new DOMException("cancelled", "AbortError"));
      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DOMException);
      expect((error as Error).name).toBe("AbortError");
      expect(error).not.toBeInstanceOf(DocumentPdfRenderError);
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });

  it("enforces the whole-document rasterization duration cap as a render fallback", async () => {
    const fakePoppler = await createFakePopplerCommand("timeout");

    try {
      const rasterizer = createPopplerPdfRasterizer({
        command: fakePoppler.command,
        pdfInfoCommand: fakePoppler.pdfInfoCommand,
        timeoutMs: 5_000,
      });
      const adapter = createNodePlatformAdapter({ env: {} });
      const promise = rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact({
          elements: [
            {
              id: "figure-1",
              metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
          ],
        }),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        maxDurationMs: 1_000,
        objectStorage: adapter.objectStorage,
        rasterizer,
        tenantId: "tenant-1",
      });
      const error = await promise.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DocumentPdfRenderError);
      expect((error as Error).message).toContain("maxDurationMs=1000");
      await expectTemporaryDirectoriesRemoved(await fakePoppler.readWorkDirs());
    } finally {
      await fakePoppler.cleanup();
    }
  });
});

async function waitForCondition(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for rasterizer test condition");
}

function artifact(input: Pick<ParseArtifact, "elements">): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId,
    elements: input.elements,
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured",
    version: 1,
  };
}
