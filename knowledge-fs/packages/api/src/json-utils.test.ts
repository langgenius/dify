import { describe, expect, it } from "vitest";

import {
  cloneJsonObject,
  jsonArrayColumn,
  jsonByteLength,
  jsonObjectColumn,
  jsonStringArrayColumn,
} from "./json-utils";

describe("json-utils", () => {
  it("clones JSON objects and rejects non-serializable byte length inputs safely", () => {
    const source = { nested: { ok: true } };
    const cloned = cloneJsonObject(source);

    cloned.nested = { ok: false };
    expect(source).toEqual({ nested: { ok: true } });
    expect(jsonByteLength({ a: "b" })).toBeGreaterThan(0);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(jsonByteLength(circular)).toBe(Number.POSITIVE_INFINITY);
  });

  it("parses JSON database columns from strings or objects with clone isolation", () => {
    const objectFromString = jsonObjectColumn({ metadata: '{"a":1}' }, "metadata");
    expect(objectFromString).toEqual({ a: 1 });

    const rawObject = { nested: { ok: true } };
    const objectFromValue = jsonObjectColumn({ metadata: rawObject }, "metadata");
    objectFromValue.nested = { ok: false };
    expect(rawObject).toEqual({ nested: { ok: true } });

    const arrayFromString = jsonArrayColumn({ tags: '["a","b"]' }, "tags");
    expect(arrayFromString).toEqual(["a", "b"]);

    const rawArray = ["a", { b: true }];
    const arrayFromValue = jsonArrayColumn({ tags: rawArray }, "tags");
    arrayFromValue[1] = { b: false };
    expect(rawArray).toEqual(["a", { b: true }]);
  });

  it("rejects invalid JSON column shapes with specific errors", () => {
    expect(() => jsonObjectColumn({ metadata: null }, "metadata")).toThrow(
      "Database row column metadata must be a JSON object",
    );
    expect(() => jsonArrayColumn({ tags: {} }, "tags")).toThrow(
      "Database row column tags must be a JSON array",
    );
    expect(() => jsonStringArrayColumn({ tags: '["a",1]' }, "tags")).toThrow(
      "Database row column tags must be a JSON string array",
    );
  });
});
