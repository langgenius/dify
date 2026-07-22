import { describe, expect, it } from "vitest";

import { getTraceErrorClass, normalizeTraceId } from "./http-tracing";

describe("HTTP tracing utilities", () => {
  it("preserves valid incoming trace ids and rejects unsafe values", () => {
    expect(normalizeTraceId(" trace_1:abc-123 ")).toBe("trace_1:abc-123");
    expect(normalizeTraceId("bad trace id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(normalizeTraceId("x".repeat(129))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("maps thrown values to low-cardinality error classes", () => {
    expect(getTraceErrorClass(new TypeError("bad"))).toBe("TypeError");
    expect(getTraceErrorClass({ nope: true })).toBe("UnknownError");
  });
});
