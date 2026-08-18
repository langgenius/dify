import { describe, expect, it } from "vitest";

import {
  type RetrievalCustomMetadataCondition,
  matchesRetrievalCustomMetadataFilter,
  normalizeRetrievalCustomMetadataFilter,
} from "./retrieval-custom-metadata";

describe("retrieval custom metadata", () => {
  it("keeps empty configuration inert and enforces bounded typed values", () => {
    expect(normalizeRetrievalCustomMetadataFilter(undefined)).toBeUndefined();
    expect(
      normalizeRetrievalCustomMetadataFilter({ conditions: [], logicalOperator: "and" }),
    ).toBeUndefined();
    expect(matchesRetrievalCustomMetadataFilter({ department: "finance" }, undefined)).toBe(true);
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: Array.from({ length: 51 }, () => ({
          comparisonOperator: "is" as const,
          fieldType: "string" as const,
          name: "department",
          value: "finance",
        })),
        logicalOperator: "and",
      }),
    ).toThrow("at most 50");
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          { comparisonOperator: ">", fieldType: "number", name: "priority", value: "3" },
        ],
        logicalOperator: "and",
      }),
    ).toThrow("numeric value");
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          {
            comparisonOperator: "after",
            fieldType: "time",
            name: "reviewed_at",
            value: "not-a-date",
          },
        ],
        logicalOperator: "and",
      }),
    ).toThrow("valid time");
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          { comparisonOperator: "is", fieldType: "string", name: "department", value: 3 },
        ],
        logicalOperator: "and",
      }),
    ).toThrow("string value");
  });

  it("normalizes time values and drops unfinished value conditions", () => {
    expect(
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          { comparisonOperator: "after", fieldType: "time", name: "reviewed_at", value: 0 },
          { comparisonOperator: "is", fieldType: "string", name: "department" },
          { comparisonOperator: "empty", fieldType: "string", name: "owner" },
        ],
        logicalOperator: "and",
      }),
    ).toEqual({
      conditions: [
        {
          comparisonOperator: "after",
          fieldType: "time",
          name: "reviewed_at",
          value: "1970-01-01T00:00:00.000Z",
        },
        {
          comparisonOperator: "empty",
          fieldType: "string",
          name: "owner",
          value: undefined,
        },
      ],
      logicalOperator: "and",
    });
  });

  it("evaluates string, number, time, empty, and logical operators", () => {
    const metadata = {
      department: "finance-emea",
      priority: 4,
      reviewed_at: "2026-08-18T12:00:00.000Z",
    };
    expect(
      matchesRetrievalCustomMetadataFilter(metadata, {
        conditions: [
          {
            comparisonOperator: "start with",
            fieldType: "string",
            name: "department",
            value: "finance",
          },
          { comparisonOperator: "≥", fieldType: "number", name: "priority", value: 3 },
          {
            comparisonOperator: "after",
            fieldType: "time",
            name: "reviewed_at",
            value: "2026-08-18T11:00:00.000Z",
          },
          { comparisonOperator: "empty", fieldType: "string", name: "owner" },
        ],
        logicalOperator: "and",
      }),
    ).toBe(true);
    expect(
      matchesRetrievalCustomMetadataFilter(metadata, {
        conditions: [
          { comparisonOperator: "is", fieldType: "string", name: "department", value: "legal" },
          { comparisonOperator: ">", fieldType: "number", name: "priority", value: 3 },
        ],
        logicalOperator: "or",
      }),
    ).toBe(true);
  });

  it("evaluates every supported comparison without coercing metadata types", () => {
    const matches = (actual: unknown, condition: RetrievalCustomMetadataCondition) =>
      matchesRetrievalCustomMetadataFilter(
        { field: actual },
        { conditions: [{ ...condition, name: "field" }], logicalOperator: "and" },
      );

    expect(
      matches(3, { comparisonOperator: "=", fieldType: "number", name: "field", value: 3 }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: "≠", fieldType: "number", name: "field", value: 4 }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: ">", fieldType: "number", name: "field", value: 2 }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: "<", fieldType: "number", name: "field", value: 4 }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: "≥", fieldType: "number", name: "field", value: 3 }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: "≤", fieldType: "number", name: "field", value: 3 }),
    ).toBe(true);
    expect(
      matches("3", { comparisonOperator: "=", fieldType: "number", name: "field", value: 3 }),
    ).toBe(false);

    expect(
      matches("2026-08-18T12:00:00.000Z", {
        comparisonOperator: "is",
        fieldType: "time",
        name: "field",
        value: "2026-08-18T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      matches("2026-08-18T11:00:00.000Z", {
        comparisonOperator: "before",
        fieldType: "time",
        name: "field",
        value: "2026-08-18T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      matches(123, {
        comparisonOperator: "after",
        fieldType: "time",
        name: "field",
        value: "2026-08-18T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      matches("not-a-date", {
        comparisonOperator: "after",
        fieldType: "time",
        name: "field",
        value: "2026-08-18T12:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      matches("finance", {
        comparisonOperator: "is not",
        fieldType: "string",
        name: "field",
        value: "legal",
      }),
    ).toBe(true);
    expect(
      matches("finance", {
        comparisonOperator: "not contains",
        fieldType: "string",
        name: "field",
        value: "legal",
      }),
    ).toBe(true);
    expect(
      matches("finance", {
        comparisonOperator: "end with",
        fieldType: "string",
        name: "field",
        value: "ance",
      }),
    ).toBe(true);
    expect(
      matches("finance", {
        comparisonOperator: "in",
        fieldType: "string",
        name: "field",
        value: "legal, finance",
      }),
    ).toBe(true);
    expect(
      matches("finance", {
        comparisonOperator: "not in",
        fieldType: "string",
        name: "field",
        value: "legal, hr",
      }),
    ).toBe(true);
    expect(
      matches("finance", {
        comparisonOperator: "not in",
        fieldType: "string",
        name: "field",
        value: " , ",
      }),
    ).toBe(true);
    expect(
      matches(3, { comparisonOperator: "is", fieldType: "string", name: "field", value: "3" }),
    ).toBe(false);
    expect(matches(null, { comparisonOperator: "empty", fieldType: "string", name: "field" })).toBe(
      true,
    );
    expect(
      matches("", { comparisonOperator: "not empty", fieldType: "string", name: "field" }),
    ).toBe(true);
  });

  it("rejects invalid names, type/operator pairs, and values", () => {
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          { comparisonOperator: "is", fieldType: "string", name: "Display Name", value: "x" },
        ],
        logicalOperator: "and",
      }),
    ).toThrow("field name");
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [{ comparisonOperator: "is", fieldType: "string", name: "system", value: "x" }],
        logicalOperator: "and",
      }),
    ).toThrow("field name");
    expect(() =>
      normalizeRetrievalCustomMetadataFilter({
        conditions: [
          { comparisonOperator: ">", fieldType: "string", name: "priority", value: "3" },
        ],
        logicalOperator: "and",
      }),
    ).toThrow("invalid for string");
  });
});
