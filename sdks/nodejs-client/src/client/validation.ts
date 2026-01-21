import { ValidationError } from "../errors/dify-error";

const MAX_STRING_LENGTH = 10000;
const MAX_LIST_LENGTH = 1000;
const MAX_DICT_LENGTH = 100;

export function ensureNonEmptyString(
  value: unknown,
  name: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new ValidationError(
      `${name} exceeds maximum length of ${MAX_STRING_LENGTH} characters`
    );
  }
}

/**
 * Validates optional string fields that must be non-empty when provided.
 * Use this for fields like `name` that are optional but should not be empty strings.
 *
 * For filter parameters that accept empty strings (e.g., `keyword: ""`),
 * use `validateParams` which allows empty strings for optional params.
 */
export function ensureOptionalString(value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string when set`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new ValidationError(
      `${name} exceeds maximum length of ${MAX_STRING_LENGTH} characters`
    );
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
  if (value.length > MAX_LIST_LENGTH) {
    throw new ValidationError(
      `${name} exceeds maximum size of ${MAX_LIST_LENGTH} items`
    );
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
  if (value === undefined || value === null) {
    return;
  }
  if (value !== "like" && value !== "dislike") {
    throw new ValidationError("rating must be either 'like' or 'dislike'");
  }
}

export function validateParams(params: Record<string, unknown>): void {
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    // Only check max length for strings; empty strings are allowed for optional params
    // Required fields are validated at method level via ensureNonEmptyString
    if (typeof value === "string") {
      if (value.length > MAX_STRING_LENGTH) {
        throw new ValidationError(
          `Parameter '${key}' exceeds maximum length of ${MAX_STRING_LENGTH} characters`
        );
      }
    } else if (Array.isArray(value)) {
      if (value.length > MAX_LIST_LENGTH) {
        throw new ValidationError(
          `Parameter '${key}' exceeds maximum size of ${MAX_LIST_LENGTH} items`
        );
      }
    } else if (typeof value === "object") {
      if (Object.keys(value as Record<string, unknown>).length > MAX_DICT_LENGTH) {
        throw new ValidationError(
          `Parameter '${key}' exceeds maximum size of ${MAX_DICT_LENGTH} items`
        );
      }
    }

    if (key === "user" && typeof value !== "string") {
      throw new ValidationError(`Parameter '${key}' must be a string`);
    }
    if (
      (key === "page" || key === "limit" || key === "page_size") &&
      !Number.isInteger(value)
    ) {
      throw new ValidationError(`Parameter '${key}' must be an integer`);
    }
    if (key === "files" && !Array.isArray(value) && typeof value !== "object") {
      throw new ValidationError(`Parameter '${key}' must be a list or dict`);
    }
    if (key === "rating" && value !== "like" && value !== "dislike") {
      throw new ValidationError(`Parameter '${key}' must be 'like' or 'dislike'`);
    }
  });
}
