import type { DatabaseRow } from "@knowledge/core";

export function stringColumn(row: DatabaseRow, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Database row column ${column} must be a string`);
  }

  return value;
}

export function optionalStringColumn(row: DatabaseRow, column: string): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Database row column ${column} must be a string`);
  }

  return value;
}

export function numberColumn(row: DatabaseRow, column: string): number {
  const value = row[column];

  if (typeof value !== "number") {
    throw new Error(`Database row column ${column} must be a number`);
  }

  return value;
}

export function optionalNumberColumn(row: DatabaseRow, column: string): number | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new Error(`Database row column ${column} must be a number`);
  }

  return value;
}
