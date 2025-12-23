import { ValidationError } from "../errors/dify-error";

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

export function ensureOptionalBoolean(value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "boolean") {
    throw new ValidationError(`${name} must be a boolean when set`);
  }
}

export function ensureStringArray(value: unknown, name: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty string array`);
  }
  value.forEach((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ValidationError(`${name} must contain non-empty strings`);
    }
  });
}

export function ensureOptionalStringArray(value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  ensureStringArray(value, name);
}

export function ensureRating(value: unknown): void {
  if (value !== "like" && value !== "dislike") {
    throw new ValidationError("rating must be either 'like' or 'dislike'");
  }
}
