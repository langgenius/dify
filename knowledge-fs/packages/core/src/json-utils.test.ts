import { describe, expect, it } from "vitest";

import { stableJson } from "./json-utils";

describe("stableJson", () => {
  it("renders objects with deterministic key order", () => {
    expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("preserves null, renders undefined array entries as null, and filters undefined object fields", () => {
    expect(stableJson(undefined)).toBe("null");
    expect(stableJson(() => "ignored")).toBe("null");
    expect(stableJson({ a: null, b: undefined, c: [undefined, null] })).toBe(
      '{"a":null,"c":[null,null]}',
    );
  });

  it("keeps array order while canonicalizing nested objects", () => {
    expect(stableJson([{ z: 1, a: 2 }, "x"])).toBe('[{"a":2,"z":1},"x"]');
  });
});
