import { describe, expect, it } from "vitest";

import {
  createDocumentObjectKey,
  normalizeSourceFsPath,
  sanitizeFilename,
  sourceObjectKeyForPath,
  sourcePathIsWithinMount,
  sourcePointerToObjectPrefix,
  sourceRelativePath,
  sourceVirtualPathForObjectKey,
} from "./storage-path-utils";

describe("storage path utilities", () => {
  it("normalizes SourceFS paths and rejects traversal or wrong roots", () => {
    expect(normalizeSourceFsPath("/sources/team/docs/")).toBe("/sources/team/docs");
    expect(() => normalizeSourceFsPath("/tmp/team")).toThrow(
      "SourceFS path must be under /sources",
    );
    expect(() => normalizeSourceFsPath("/sources/team/../secret")).toThrow(
      "SourceFS path must not contain traversal segments",
    );
  });

  it("maps between object keys and SourceFS virtual paths", () => {
    expect(
      sourcePointerToObjectPrefix({
        provider: "object-storage",
        sourcePointer: "object://tenant/spaces/space/documents",
      }),
    ).toBe("tenant/spaces/space/documents/");

    expect(
      sourceObjectKeyForPath({
        objectPrefix: "tenant/spaces/space/documents/",
        relativePath: "manuals/readme.md",
      }),
    ).toBe("tenant/spaces/space/documents/manuals/readme.md");

    expect(
      sourceVirtualPathForObjectKey({
        mountPath: "/sources/manuals/",
        objectKey: "tenant/spaces/space/documents/manuals/readme.md",
        objectPrefix: "tenant/spaces/space/documents/",
      }),
    ).toBe("/sources/manuals/manuals/readme.md");
  });

  it("keeps SourceFS mount checks and relative paths stable", () => {
    expect(sourcePathIsWithinMount("/sources/a/b", "/sources/a")).toBe(true);
    expect(sourcePathIsWithinMount("/sources/ab", "/sources/a")).toBe(false);
    expect(sourceRelativePath("/sources/a/b/c.txt", "/sources/a")).toBe("b/c.txt");
    expect(sourceRelativePath("/sources/a", "/sources/a")).toBe("");
  });

  it("sanitizes upload filenames for isolated document object keys", () => {
    expect(sanitizeFilename(" ../Q2 Report FINAL!!.PDF ")).toBe("q2-report-final-.pdf");
    expect(sanitizeFilename("../../../")).toBe("upload");
    expect(
      createDocumentObjectKey({
        assetId: "asset-1",
        filename: "../Q2 Report FINAL!!.PDF",
        knowledgeSpaceId: "space-1",
        tenantId: "tenant-1",
      }),
    ).toBe("tenant-1/spaces/space-1/documents/asset-1/q2-report-final-.pdf");
  });
});
