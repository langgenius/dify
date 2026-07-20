import type { DatabaseRow } from "@knowledge/core";

export function cloneJsonObject(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonObjectColumn(row: DatabaseRow, column: string): Record<string, unknown> {
  const value = row[column];

  if (typeof value === "string") {
    return cloneJsonObject(JSON.parse(value) as Record<string, unknown>);
  }

  if (isPlainObject(value)) {
    return cloneJsonObject(value);
  }

  throw new Error(`Database row column ${column} must be a JSON object`);
}

export function jsonArrayColumn(row: DatabaseRow, column: string): unknown[] {
  const value = row[column];

  if (typeof value === "string") {
    return JSON.parse(value) as unknown[];
  }

  if (Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value)) as unknown[];
  }

  throw new Error(`Database row column ${column} must be a JSON array`);
}

export function jsonStringArrayColumn(row: DatabaseRow, column: string): string[] {
  const value = jsonArrayColumn(row, column);

  if (!value.every((item) => typeof item === "string")) {
    throw new Error(`Database row column ${column} must be a JSON string array`);
  }

  return value;
}
