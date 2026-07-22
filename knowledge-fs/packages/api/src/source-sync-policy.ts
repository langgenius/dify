import { z } from "zod";

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const UTC_OFFSET_PATTERN = /^[+-](0\d|1[0-3]):[0-5]\d$/u;

/**
 * Scheduled-sync policy for a source, stored as `metadata.syncPolicy`:
 * - `{ everyHours: 6 }` — sync every N hours after the last sync.
 * - `{ dailyAt: ["03:00", "15:30"], utcOffset?: "+08:00" }` — sync at fixed times of day
 *   (UTC unless an offset is given).
 */
export const SourceSyncPolicySchema = z.union([
  z
    .object({
      everyHours: z.number().int().min(1).max(720),
    })
    .strict(),
  z
    .object({
      dailyAt: z.array(z.string().regex(TIME_OF_DAY_PATTERN, "must be HH:MM")).min(1).max(24),
      utcOffset: z.string().regex(UTC_OFFSET_PATTERN, "must be ±HH:MM").optional(),
    })
    .strict(),
]);

export type SourceSyncPolicy = z.infer<typeof SourceSyncPolicySchema>;

export class SourceSyncPolicyError extends Error {}

/** Validates a caller-supplied `metadata.syncPolicy`; throws a typed error for 400 mapping. */
export function parseSourceSyncPolicy(value: unknown): SourceSyncPolicy {
  const parsed = SourceSyncPolicySchema.safeParse(value);

  if (!parsed.success) {
    throw new SourceSyncPolicyError(
      `Invalid source syncPolicy: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

/** Reads the policy from source metadata; absent or invalid policies read as null (no schedule). */
export function readSourceSyncPolicy(
  metadata: Readonly<Record<string, unknown>>,
): SourceSyncPolicy | null {
  if (metadata.syncPolicy === undefined || metadata.syncPolicy === null) {
    return null;
  }

  const parsed = SourceSyncPolicySchema.safeParse(metadata.syncPolicy);

  return parsed.success ? parsed.data : null;
}

/** Scheduler bookkeeping stored as `metadata.syncState`; written by the sync scheduler. */
export interface SourceSyncState {
  readonly lastSyncAt?: string | undefined;
  readonly lastSyncError?: string | undefined;
  readonly lastSyncErrorCode?: string | undefined;
  readonly lastSyncStatus?: "error" | "ok" | undefined;
  readonly nextSyncAt?: string | undefined;
  readonly syncStartedAt?: string | undefined;
}

export function readSourceSyncState(metadata: Readonly<Record<string, unknown>>): SourceSyncState {
  const value = metadata.syncState;

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;

  return {
    ...(typeof record.lastSyncAt === "string" ? { lastSyncAt: record.lastSyncAt } : {}),
    ...(typeof record.lastSyncError === "string" ? { lastSyncError: record.lastSyncError } : {}),
    ...(typeof record.lastSyncErrorCode === "string"
      ? { lastSyncErrorCode: record.lastSyncErrorCode }
      : {}),
    ...(record.lastSyncStatus === "ok" || record.lastSyncStatus === "error"
      ? { lastSyncStatus: record.lastSyncStatus }
      : {}),
    ...(typeof record.nextSyncAt === "string" ? { nextSyncAt: record.nextSyncAt } : {}),
    ...(typeof record.syncStartedAt === "string" ? { syncStartedAt: record.syncStartedAt } : {}),
  };
}

/** The next sync instant strictly after `fromIso`, per the policy. */
export function computeNextSyncAt(policy: SourceSyncPolicy, fromIso: string): string {
  const fromMs = Date.parse(fromIso);

  if (!Number.isFinite(fromMs)) {
    throw new SourceSyncPolicyError(`Invalid sync anchor timestamp: ${fromIso}`);
  }

  if ("everyHours" in policy) {
    return new Date(fromMs + policy.everyHours * 3_600_000).toISOString();
  }

  const offsetMs = utcOffsetMs(policy.utcOffset);
  // Work in "local" time (UTC shifted by the offset): find the earliest configured time-of-day
  // strictly after `from`, today or tomorrow, then shift back to UTC.
  const local = new Date(fromMs + offsetMs);
  let nextLocalMs = Number.POSITIVE_INFINITY;

  for (const time of policy.dailyAt) {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    let candidate = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hours,
      minutes,
    );

    if (candidate <= local.getTime()) {
      candidate += 86_400_000;
    }

    nextLocalMs = Math.min(nextLocalMs, candidate);
  }

  return new Date(nextLocalMs - offsetMs).toISOString();
}

function utcOffsetMs(offset: string | undefined): number {
  if (!offset) {
    return 0;
  }

  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours = 0, minutes = 0] = offset.slice(1).split(":").map(Number);

  return sign * (hours * 60 + minutes) * 60_000;
}
