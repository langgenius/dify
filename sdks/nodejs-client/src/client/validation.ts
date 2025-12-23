import { ValidationError } from "../errors/dify-error";

export const ensureNonEmptyString = (
  value: unknown,
  name: string
): asserts value is string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
};

export const ensureOptionalString = (value: unknown, name: string): void => {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string when set`);
  }
};

export const ensureOptionalInt = (value: unknown, name: string): void => {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${name} must be an integer when set`);
  }
};

export const ensureRating = (value: unknown): void => {
  if (value !== "like" && value !== "dislike") {
    throw new ValidationError("rating must be either 'like' or 'dislike'");
  }
};
