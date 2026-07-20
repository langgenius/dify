import { describe, expect, it } from "vitest";

import { isJobPayload, isJobPayloadRecord, toJobPayloadRecord } from "./job-payload-utils";

describe("job payload utilities", () => {
  it("clones and validates JSON-compatible job payload records", () => {
    const source = {
      nested: { ids: ["a", "b"], retry: true },
      score: 1,
    };

    const result = toJobPayloadRecord(source);
    source.nested.ids.push("mutated");

    expect(result).toEqual({
      nested: { ids: ["a", "b"], retry: true },
      score: 1,
    });
    expect(isJobPayloadRecord(result)).toBe(true);
  });

  it("rejects non-JSON-compatible values after serialization", () => {
    expect(() => toJobPayloadRecord({ value: BigInt(1) })).toThrow(
      "Research task metadata must be JSON payload compatible",
    );
    expect(isJobPayload({ value: undefined })).toBe(false);
  });
});
