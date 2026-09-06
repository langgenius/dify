import { describe, expect, it } from "vitest";

import {
  ParserResourceLimitError,
  assertJsonDepth,
  assertParserResourceBudget,
} from "./parser-resource-budget";

describe("parser resource budgets", () => {
  it("bounds nested JSON before a recursive decoder sees it", () => {
    expect(() => assertJsonDepth(`${"[".repeat(129)}0${"]".repeat(129)}`)).toThrow(
      ParserResourceLimitError,
    );
    expect(() => assertJsonDepth('{"text":"[[[\\"{}"}')).not.toThrow();
  });
  it("accepts the nesting boundary", () => {
    expect(() => assertJsonDepth(`${"[".repeat(128)}0${"]".repeat(128)}`)).not.toThrow();
  });
  it("counts escaped strings and object keys against a byte budget", () => {
    const value = { key: '\u0000\n\\"中文\ud800' };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes })).not.toThrow();
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes - 1 })).toThrow(
      ParserResourceLimitError,
    );
  });
  it("rejects cycles and excessive nodes without recursive traversal", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => assertParserResourceBudget(cycle)).toThrow(ParserResourceLimitError);
    expect(() => assertParserResourceBudget([1, 2, 3], { maxNodes: 3 })).toThrow(
      ParserResourceLimitError,
    );
  });
  it("counts repeated references as their expanded serialization", () => {
    const child = { text: "sample" };
    expect(() => assertParserResourceBudget([child, child], { maxBytes: 20 })).toThrow(
      ParserResourceLimitError,
    );
  });
  it("preserves cancellation", () => {
    const reason = new Error("cancelled");
    expect(() => assertJsonDepth("{}", AbortSignal.abort(reason))).toThrow(reason);
    expect(() => assertParserResourceBudget({}, { signal: AbortSignal.abort(reason) })).toThrow(
      reason,
    );
  });

  it.each([
    null,
    true,
    false,
    0,
    -123,
    "",
    "plain ASCII",
    'quote: " slash: \\',
    "\b\t\n\f\r\u0000\u001f",
    "中文😀\u2028\u2029",
    "\ud800",
    "\udc00",
    "\ud800\ud800\udc00\udc00",
    [],
    [null, true, "😀", 12],
    { '\u0000"\\😀': [1, "\ud800", {}] },
  ])("counts exact compact JSON bytes for %j", (value) => {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes })).not.toThrow();
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes - 1 })).toThrow(
      ParserResourceLimitError,
    );
  });

  it("does not count inherited prototype fields as serialized document data", () => {
    const value = Object.assign(Object.create({ inherited: "ignored" }), { own: "keep" });
    const bytes = Buffer.byteLength(JSON.stringify(value));
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes })).not.toThrow();
  });

  it("accepts the node boundary and rejects its next item", () => {
    expect(() => assertParserResourceBudget([1, 2], { maxNodes: 3 })).not.toThrow();
    expect(() => assertParserResourceBudget([1, 2, 3], { maxNodes: 3 })).toThrow(
      ParserResourceLimitError,
    );
  });

  it("counts repeated aliases by serialized expansion rather than unique identity", () => {
    const child = { value: ["shared", 42] };
    const value = [child, child, child];
    const bytes = Buffer.byteLength(JSON.stringify(value));
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes })).not.toThrow();
    expect(() => assertParserResourceBudget(value, { maxBytes: bytes - 1 })).toThrow(
      ParserResourceLimitError,
    );
  });

  it("stops traversing a wide object once its node budget is exhausted", () => {
    let reads = 0;
    const value: Record<string, unknown> = {};
    for (let index = 0; index < 100; index += 1) {
      Object.defineProperty(value, String(index), {
        enumerable: true,
        get: () => {
          reads += 1;
          return "data";
        },
      });
    }
    expect(() => assertParserResourceBudget(value, { maxNodes: 3 })).toThrow(
      ParserResourceLimitError,
    );
    expect(reads).toBeLessThanOrEqual(3);
  });

  it("handles escaped quotes and backslashes without treating text as JSON structure", () => {
    const source = JSON.stringify({ text: '"\\'.repeat(150) + "[".repeat(300) });
    expect(() => assertJsonDepth(source)).not.toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5])(
    "rejects an invalid node budget instead of disabling it: %s",
    (maxNodes) => {
      expect(() => assertParserResourceBudget(null, { maxNodes })).toThrow();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5])(
    "rejects an invalid byte budget instead of disabling it: %s",
    (maxBytes) => {
      expect(() => assertParserResourceBudget(null, { maxBytes })).toThrow();
    },
  );
});
