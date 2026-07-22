import { describe, expect, it } from "vitest";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";

describe("database-row-utils", () => {
  it("reads required and optional string columns", () => {
    expect(stringColumn({ name: "Knowledge" }, "name")).toBe("Knowledge");
    expect(optionalStringColumn({ name: null }, "name")).toBeUndefined();
    expect(optionalStringColumn({ name: undefined }, "name")).toBeUndefined();
    expect(optionalStringColumn({ name: "Knowledge" }, "name")).toBe("Knowledge");
  });

  it("reads required and optional number columns", () => {
    expect(numberColumn({ count: 3 }, "count")).toBe(3);
    expect(optionalNumberColumn({ count: null }, "count")).toBeUndefined();
    expect(optionalNumberColumn({ count: undefined }, "count")).toBeUndefined();
    expect(optionalNumberColumn({ count: 3 }, "count")).toBe(3);
  });

  it("rejects invalid column shapes with specific errors", () => {
    expect(() => stringColumn({ name: 1 }, "name")).toThrow(
      "Database row column name must be a string",
    );
    expect(() => optionalStringColumn({ name: 1 }, "name")).toThrow(
      "Database row column name must be a string",
    );
    expect(() => numberColumn({ count: "3" }, "count")).toThrow(
      "Database row column count must be a number",
    );
    expect(() => optionalNumberColumn({ count: "3" }, "count")).toThrow(
      "Database row column count must be a number",
    );
  });
});
