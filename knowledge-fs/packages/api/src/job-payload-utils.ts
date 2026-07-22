import type { JobPayload } from "@knowledge/core";

import { isPlainObject } from "./json-utils";

const JOB_PAYLOAD_COMPATIBILITY_ERROR = "Research task metadata must be JSON payload compatible";

export function toJobPayloadRecord(input: Record<string, unknown>): Record<string, JobPayload> {
  let cloned: unknown;

  try {
    cloned = JSON.parse(JSON.stringify(input)) as unknown;
  } catch {
    throw new Error(JOB_PAYLOAD_COMPATIBILITY_ERROR);
  }

  if (!isJobPayloadRecord(cloned)) {
    throw new Error(JOB_PAYLOAD_COMPATIBILITY_ERROR);
  }

  return cloned;
}

export function isJobPayloadRecord(value: unknown): value is Record<string, JobPayload> {
  return isPlainObject(value) && Object.values(value).every(isJobPayload);
}

export function isJobPayload(value: unknown): value is JobPayload {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJobPayload);
  }

  return isPlainObject(value) && Object.values(value).every(isJobPayload);
}
