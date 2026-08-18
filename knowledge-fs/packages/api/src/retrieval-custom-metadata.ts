export const RetrievalCustomMetadataFieldTypes = ["string", "number", "time"] as const;
export type RetrievalCustomMetadataFieldType = (typeof RetrievalCustomMetadataFieldTypes)[number];

export const RetrievalCustomMetadataComparisonOperators = [
  "contains",
  "not contains",
  "start with",
  "end with",
  "is",
  "is not",
  "empty",
  "not empty",
  "in",
  "not in",
  "=",
  "≠",
  ">",
  "<",
  "≥",
  "≤",
  "before",
  "after",
] as const;
export type RetrievalCustomMetadataComparisonOperator =
  (typeof RetrievalCustomMetadataComparisonOperators)[number];

export interface RetrievalCustomMetadataCondition {
  readonly comparisonOperator: RetrievalCustomMetadataComparisonOperator;
  readonly fieldType: RetrievalCustomMetadataFieldType;
  readonly name: string;
  readonly value?: number | string | undefined;
}

export interface RetrievalCustomMetadataFilter {
  readonly conditions: readonly RetrievalCustomMetadataCondition[];
  readonly logicalOperator: "and" | "or";
}

const customMetadataNamePattern = /^[a-z][a-z0-9_]{0,254}$/u;
const reservedCustomMetadataNames = new Set([
  "displayName",
  "provenance",
  "retrievalCount",
  "sourceName",
  "system",
]);
const operatorsByFieldType: Record<
  RetrievalCustomMetadataFieldType,
  ReadonlySet<RetrievalCustomMetadataComparisonOperator>
> = {
  number: new Set(["=", "≠", ">", "<", "≥", "≤", "empty", "not empty"]),
  string: new Set([
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
  ]),
  time: new Set(["is", "before", "after", "empty", "not empty"]),
};
const valueOptionalOperators = new Set<RetrievalCustomMetadataComparisonOperator>([
  "empty",
  "not empty",
]);

export function normalizeRetrievalCustomMetadataFilter(
  filter: RetrievalCustomMetadataFilter | undefined,
): RetrievalCustomMetadataFilter | undefined {
  if (!filter) return undefined;
  if (filter.conditions.length > 50) {
    throw new Error("Retrieval custom metadata filters support at most 50 conditions");
  }

  const conditions: RetrievalCustomMetadataCondition[] = [];
  for (const condition of filter.conditions) {
    const name = condition.name.trim();
    if (!customMetadataNamePattern.test(name) || reservedCustomMetadataNames.has(name)) {
      throw new Error(`Retrieval custom metadata field name ${condition.name} is invalid`);
    }
    if (!operatorsByFieldType[condition.fieldType].has(condition.comparisonOperator)) {
      throw new Error(
        `Retrieval custom metadata operator ${condition.comparisonOperator} is invalid for ${condition.fieldType}`,
      );
    }
    if (valueOptionalOperators.has(condition.comparisonOperator)) {
      conditions.push({ ...condition, name, value: undefined });
      continue;
    }
    if (condition.value === undefined) continue;

    if (condition.fieldType === "number") {
      if (typeof condition.value !== "number" || !Number.isFinite(condition.value)) {
        throw new Error(`Retrieval custom metadata field ${name} requires a numeric value`);
      }
      conditions.push({ ...condition, name, value: condition.value });
      continue;
    }
    if (condition.fieldType === "time") {
      const timestamp =
        typeof condition.value === "number" ? condition.value * 1_000 : Date.parse(condition.value);
      const date = new Date(timestamp);
      if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) {
        throw new Error(`Retrieval custom metadata field ${name} requires a valid time value`);
      }
      conditions.push({ ...condition, name, value: date.toISOString() });
      continue;
    }
    if (typeof condition.value !== "string") {
      throw new Error(`Retrieval custom metadata field ${name} requires a string value`);
    }
    conditions.push({ ...condition, name, value: condition.value });
  }

  if (conditions.length === 0) return undefined;
  return {
    conditions,
    logicalOperator: filter.logicalOperator === "or" ? "or" : "and",
  };
}

export function matchesRetrievalCustomMetadataFilter(
  userMetadata: Readonly<Record<string, unknown>>,
  filter: RetrievalCustomMetadataFilter | undefined,
): boolean {
  return createRetrievalCustomMetadataMatcher(filter)(userMetadata);
}

export function createRetrievalCustomMetadataMatcher(
  filter: RetrievalCustomMetadataFilter | undefined,
): (userMetadata: Readonly<Record<string, unknown>>) => boolean {
  const normalized = normalizeRetrievalCustomMetadataFilter(filter);
  if (!normalized) return () => true;

  return (userMetadata) => {
    const results = normalized.conditions.map((condition) =>
      matchesCondition(userMetadata[condition.name], condition),
    );
    return normalized.logicalOperator === "or" ? results.some(Boolean) : results.every(Boolean);
  };
}

function matchesCondition(actual: unknown, condition: RetrievalCustomMetadataCondition): boolean {
  if (condition.comparisonOperator === "empty") return actual === undefined || actual === null;
  if (condition.comparisonOperator === "not empty") return actual !== undefined && actual !== null;

  if (condition.fieldType === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
    const expected = condition.value as number;
    if (condition.comparisonOperator === "=") return actual === expected;
    if (condition.comparisonOperator === "≠") return actual !== expected;
    if (condition.comparisonOperator === ">") return actual > expected;
    if (condition.comparisonOperator === "<") return actual < expected;
    if (condition.comparisonOperator === "≥") return actual >= expected;
    return actual <= expected;
  }

  if (condition.fieldType === "time") {
    if (typeof actual !== "string") return false;
    const actualTimestamp = Date.parse(actual);
    const expectedTimestamp = Date.parse(condition.value as string);
    if (Number.isNaN(actualTimestamp) || Number.isNaN(expectedTimestamp)) return false;
    if (condition.comparisonOperator === "is") return actualTimestamp === expectedTimestamp;
    if (condition.comparisonOperator === "before") return actualTimestamp < expectedTimestamp;
    return actualTimestamp > expectedTimestamp;
  }

  const expected = condition.value as string;
  if (condition.comparisonOperator === "in" || condition.comparisonOperator === "not in") {
    const values = expected
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) return condition.comparisonOperator === "not in";
    if (typeof actual !== "string") return false;
    return condition.comparisonOperator === "in"
      ? values.includes(actual)
      : !values.includes(actual);
  }
  if (typeof actual !== "string") return false;
  if (condition.comparisonOperator === "is") return actual === expected;
  if (condition.comparisonOperator === "is not") return actual !== expected;
  if (condition.comparisonOperator === "contains") return actual.includes(expected);
  if (condition.comparisonOperator === "not contains") return !actual.includes(expected);
  if (condition.comparisonOperator === "start with") return actual.startsWith(expected);
  if (condition.comparisonOperator === "end with") return actual.endsWith(expected);
  return false;
}
