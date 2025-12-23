import { ValidationError } from "../errors/dify-error.js";

export function ensureNonEmptyString(
  value: unknown,
  name: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
}

export function ensureOptionalString(value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string when set`);
  }
}

export function ensureOptionalInt(value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${name} must be an integer when set`);
  }
}

export function ensureRating(value: unknown): void {
  if (value !== "like" && value !== "dislike") {
    throw new ValidationError("rating must be either 'like' or 'dislike'");
  }
}
