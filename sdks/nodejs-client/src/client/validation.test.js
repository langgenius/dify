import { describe, expect, it } from "vitest";
import {
  ensureNonEmptyString,
  ensureOptionalBoolean,
  ensureOptionalInt,
  ensureOptionalString,
  ensureOptionalStringArray,
  ensureRating,
  ensureStringArray,
  validateParams,
} from "./validation";

const makeLongString = (length) => "a".repeat(length);

describe("validation utilities", () => {
  it("ensureNonEmptyString throws on empty or whitespace", () => {
    expect(() => ensureNonEmptyString("", "name")).toThrow();
    expect(() => ensureNonEmptyString("   ", "name")).toThrow();
  });

  it("ensureNonEmptyString throws on overly long strings", () => {
    expect(() =>
      ensureNonEmptyString(makeLongString(10001), "name")
    ).toThrow();
  });

  it("ensureOptionalString ignores undefined and validates when set", () => {
    expect(() => ensureOptionalString(undefined, "opt")).not.toThrow();
    expect(() => ensureOptionalString("", "opt")).toThrow();
  });

  it("ensureOptionalString throws on overly long strings", () => {
    expect(() => ensureOptionalString(makeLongString(10001), "opt")).toThrow();
  });

  it("ensureOptionalInt validates integer", () => {
    expect(() => ensureOptionalInt(undefined, "limit")).not.toThrow();
    expect(() => ensureOptionalInt(1.2, "limit")).toThrow();
  });

  it("ensureOptionalBoolean validates boolean", () => {
    expect(() => ensureOptionalBoolean(undefined, "flag")).not.toThrow();
    expect(() => ensureOptionalBoolean("yes", "flag")).toThrow();
  });

  it("ensureStringArray enforces size and content", () => {
    expect(() => ensureStringArray([], "items")).toThrow();
    expect(() => ensureStringArray([""], "items")).toThrow();
    expect(() =>
      ensureStringArray(Array.from({ length: 1001 }, () => "a"), "items")
    ).toThrow();
    expect(() => ensureStringArray(["ok"], "items")).not.toThrow();
  });

  it("ensureOptionalStringArray ignores undefined", () => {
    expect(() => ensureOptionalStringArray(undefined, "tags")).not.toThrow();
  });

  it("ensureOptionalStringArray validates when set", () => {
    expect(() => ensureOptionalStringArray(["valid"], "tags")).not.toThrow();
    expect(() => ensureOptionalStringArray([], "tags")).toThrow();
    expect(() => ensureOptionalStringArray([""], "tags")).toThrow();
  });

  it("ensureRating validates allowed values", () => {
    expect(() => ensureRating(undefined)).not.toThrow();
    expect(() => ensureRating("like")).not.toThrow();
    expect(() => ensureRating("bad")).toThrow();
  });

  it("validateParams enforces generic rules", () => {
    expect(() => validateParams({ user: 123 })).toThrow();
    expect(() => validateParams({ rating: "bad" })).toThrow();
    expect(() => validateParams({ page: 1.1 })).toThrow();
    expect(() => validateParams({ files: "bad" })).toThrow();
    // Empty strings are allowed for optional params (e.g., keyword: "" means no filter)
    expect(() => validateParams({ keyword: "" })).not.toThrow();
    expect(() => validateParams({ name: makeLongString(10001) })).toThrow();
    expect(() =>
      validateParams({ items: Array.from({ length: 1001 }, () => "a") })
    ).toThrow();
    expect(() =>
      validateParams({
        data: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [String(i), i])
        ),
      })
    ).toThrow();
    expect(() => validateParams({ user: "u", page: 1 })).not.toThrow();
  });
});
