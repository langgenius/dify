import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  cloneEvidenceBundle,
  cloneTextDiffOperation,
  deterministicChildId,
  uniqueStrings,
} from "./api-shared-utils";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";

describe("api-shared-utils", () => {
  it("generates stable deterministic child ids without runtime randomness", () => {
    const first = deterministicChildId(UUID_A, "child:alpha");
    const second = deterministicChildId(UUID_A, "child:alpha");
    const other = deterministicChildId(UUID_A, "child:beta");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("deduplicates strings while preserving first-seen order", () => {
    expect(uniqueStrings(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("clone-isolates evidence bundles and text diff operations", () => {
    const bundle = EvidenceBundleSchema.parse({
      createdAt: "2026-05-14T00:00:00.000Z",
      id: UUID_A,
      items: [
        {
          citations: [
            {
              artifactHash: "a".repeat(64),
              documentAssetId: UUID_B,
              documentVersion: 1,
              endOffset: 10,
              parseArtifactId: UUID_A,
              sectionPath: ["Intro"],
              startOffset: 0,
            },
          ],
          conflicts: [],
          freshness: { checkedAt: "2026-05-14T00:00:00.000Z", status: "fresh" },
          metadata: { nested: { ok: true } },
          nodeId: UUID_B,
          score: 0.9,
          scores: { final: 0.9, retrieval: 0.8 },
          text: "evidence",
        },
      ],
      query: "question",
      state: "answerable",
    });
    const clonedBundle = cloneEvidenceBundle(bundle);
    const clonedItem = clonedBundle.items.at(0);
    const sourceItem = bundle.items.at(0);

    expect(clonedItem).toBeDefined();
    expect(sourceItem).toBeDefined();
    if (!clonedItem || !sourceItem) {
      throw new Error("expected evidence items for clone isolation test");
    }

    clonedItem.metadata = { nested: { ok: false } };
    expect(sourceItem.metadata).toEqual({ nested: { ok: true } });

    const operation = { kind: "insert" as const, newEnd: 3, newStart: 1, text: "abc" };
    const clonedOperation = cloneTextDiffOperation(operation);
    clonedOperation.text = "changed";

    expect(operation.text).toBe("abc");
  });
});
