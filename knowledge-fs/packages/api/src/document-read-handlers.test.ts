import { describe, expect, it } from "vitest";

import { CandidateVisibilityScanBudgetExceededError } from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { buildAssetResponseHeaders, listReadableDocumentAssets } from "./document-read-handlers";

import type { DocumentAsset } from "@knowledge/core";

describe("buildAssetResponseHeaders", () => {
  it("serves allowlisted image types inline with hardening headers", () => {
    const headers = buildAssetResponseHeaders({
      contentType: "image/png",
      itemId: "item-1",
      sizeBytes: 8,
    });

    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("content-disposition")).toBe("inline");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(headers.get("content-length")).toBe("8");
    expect(headers.get("x-document-multimodal-item-id")).toBe("item-1");
  });

  it("neutralizes SVG (and other non-allowlisted types) as an opaque attachment", () => {
    const svg = buildAssetResponseHeaders({
      contentType: "image/svg+xml",
      itemId: "item-2",
      sizeBytes: 4,
    });

    expect(svg.get("content-type")).toBe("application/octet-stream");
    expect(svg.get("content-disposition")).toBe("attachment");
    expect(svg.get("x-content-type-options")).toBe("nosniff");
    expect(svg.get("content-security-policy")).toBe("default-src 'none'; sandbox");

    const html = buildAssetResponseHeaders({
      contentType: "text/html",
      itemId: "item-3",
      sizeBytes: 4,
    });
    expect(html.get("content-type")).toBe("application/octet-stream");
    expect(html.get("content-disposition")).toBe("attachment");

    const unknown = buildAssetResponseHeaders({ itemId: "item-4", sizeBytes: 4 });
    expect(unknown.get("content-type")).toBe("application/octet-stream");
    expect(unknown.get("content-disposition")).toBe("attachment");
  });

  it("normalizes casing and records the variant when present", () => {
    const headers = buildAssetResponseHeaders({
      contentType: "IMAGE/JPEG",
      itemId: "item-5",
      sizeBytes: 12,
      variant: "thumbnail",
    });

    expect(headers.get("content-type")).toBe("image/jpeg");
    expect(headers.get("content-disposition")).toBe("inline");
    expect(headers.get("x-document-multimodal-asset-variant")).toBe("thumbnail");
  });

  it("fails closed instead of exposing a hidden raw cursor when the scan budget is exhausted", async () => {
    const assets = Array.from({ length: 11 }, (_value, index) =>
      documentAsset(String(index + 1).padStart(2, "0"), index < 10),
    );
    let listCalls = 0;
    const repository = {
      list: async ({ cursor }: { readonly cursor?: { readonly id: string } }) => {
        listCalls += 1;
        const next = assets.find((asset) => !cursor || asset.id > cursor.id);
        const nextIndex = next ? assets.indexOf(next) : -1;
        return {
          items: next ? [next] : [],
          ...(nextIndex >= 0 && nextIndex < assets.length - 1
            ? { nextCursor: { id: next?.id ?? "" } }
            : {}),
        };
      },
    } as unknown as DocumentAssetRepository;

    await expect(
      listReadableDocumentAssets({
        candidateGrants: [],
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        limit: 1,
        repository,
      }),
    ).rejects.toBeInstanceOf(CandidateVisibilityScanBudgetExceededError);
    expect(listCalls).toBe(10);
  });

  it("only returns a cursor anchored to the last visible asset", async () => {
    const assets = [
      documentAsset("01", false),
      documentAsset("02", true),
      documentAsset("03", false),
    ];
    const repository = {
      list: async ({ cursor }: { readonly cursor?: { readonly id: string } }) => {
        const next = assets.find((asset) => !cursor || asset.id > cursor.id);
        const nextIndex = next ? assets.indexOf(next) : -1;
        return {
          items: next ? [next] : [],
          ...(nextIndex >= 0 && nextIndex < assets.length - 1
            ? { nextCursor: { id: next?.id ?? "" } }
            : {}),
        };
      },
    } as unknown as DocumentAssetRepository;

    const result = await listReadableDocumentAssets({
      candidateGrants: [],
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      limit: 1,
      repository,
    });
    expect(result.items.map((asset) => asset.id)).toEqual([assets[0]?.id]);
    expect(result.nextCursor).toEqual({ id: assets[0]?.id });
  });
});

function documentAsset(suffix: string, restricted: boolean): DocumentAsset {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    filename: `${suffix}.md`,
    id: `20000000-0000-4000-8000-0000000000${suffix}`,
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata: restricted ? { permissionScope: ["owner-only"] } : {},
    mimeType: "text/markdown",
    objectKey: `objects/${suffix}.md`,
    parserStatus: "parsed",
    sha256: "a".repeat(64),
    sizeBytes: 1,
    version: 1,
  };
}
