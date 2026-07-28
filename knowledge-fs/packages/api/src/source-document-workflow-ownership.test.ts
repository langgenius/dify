import { describe, expect, it } from "vitest";

import {
  createSourceWorkflowDocumentAssetId,
  sourceWorkflowOwnershipMatches,
} from "./source-document-workflow-ownership";

const ownership = {
  contentHash: "a".repeat(64),
  itemKey: "provider:item-1",
  runId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10",
};

describe("source document workflow ownership", () => {
  it("derives a stable UUID-shaped asset id", () => {
    const first = createSourceWorkflowDocumentAssetId(ownership);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(createSourceWorkflowDocumentAssetId(ownership)).toBe(first);
    expect(
      createSourceWorkflowDocumentAssetId({
        ...ownership,
        itemKey: "provider:item-2",
      }),
    ).not.toBe(first);
  });

  it("matches only the complete persisted ownership tuple", () => {
    expect(sourceWorkflowOwnershipMatches(ownership, ownership)).toBe(true);
    for (const value of [
      null,
      [],
      { ...ownership, runId: "another-run" },
      { ...ownership, itemKey: "another-item" },
      { ...ownership, contentHash: "b".repeat(64) },
    ]) {
      expect(sourceWorkflowOwnershipMatches(value, ownership)).toBe(false);
    }
  });
});
