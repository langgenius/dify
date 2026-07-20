import { createHash, randomUUID } from "node:crypto";

import { stableJson } from "@knowledge/core";

import { candidatePermissionScopeAllows } from "./candidate-content-authorization";

export const KnowledgeSpaceActivityActions = [
  "query.requested",
  "query.completed",
  "query.failed",
  "document.published",
  "document.failed",
  "source.synced",
  "source.failed",
  "settings.updated",
  "permission.updated",
  "profile.published",
  "worker.failed",
] as const;
export type KnowledgeSpaceActivityAction = (typeof KnowledgeSpaceActivityActions)[number];

export const KnowledgeSpaceActivityResourceTypes = [
  "knowledge-space",
  "query",
  "document",
  "source",
  "permission",
  "profile",
  "publication",
  "worker",
] as const;
export type KnowledgeSpaceActivityResourceType =
  (typeof KnowledgeSpaceActivityResourceTypes)[number];

export const KnowledgeSpaceActivityResults = ["pending", "success", "failure", "canceled"] as const;
export type KnowledgeSpaceActivityResult = (typeof KnowledgeSpaceActivityResults)[number];

export interface KnowledgeSpaceActivityEvent {
  readonly action: KnowledgeSpaceActivityAction;
  readonly actor: {
    readonly id?: string | undefined;
    readonly type: "member" | "system";
  };
  /** A deliberately small allow-list; query text, credentials, tokens and object keys are absent. */
  readonly details: Readonly<Record<string, boolean | number | string>>;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly occurredAt: string;
  readonly requiredPermissionScope: readonly string[];
  readonly resource: {
    readonly id?: string | undefined;
    readonly type: KnowledgeSpaceActivityResourceType;
  };
  readonly result: KnowledgeSpaceActivityResult;
  readonly tenantId: string;
}

export interface AppendKnowledgeSpaceActivityInput
  extends Omit<KnowledgeSpaceActivityEvent, "details" | "id"> {
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly id?: string | undefined;
}

export interface KnowledgeSpaceActivityCursor {
  readonly id: string;
  readonly occurredAt: string;
}

export interface ListKnowledgeSpaceActivityInput {
  readonly action?: KnowledgeSpaceActivityAction | undefined;
  readonly candidateGrants: readonly string[];
  readonly cursor?: KnowledgeSpaceActivityCursor | undefined;
  readonly from?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly resourceType?: KnowledgeSpaceActivityResourceType | undefined;
  readonly result?: KnowledgeSpaceActivityResult | undefined;
  readonly tenantId: string;
  readonly to?: string | undefined;
}

export interface ListKnowledgeSpaceActivityResult {
  readonly items: readonly KnowledgeSpaceActivityEvent[];
  readonly nextCursor?: KnowledgeSpaceActivityCursor | undefined;
}

export const KnowledgeSpaceOverviewWindowKeys = ["24h", "7d", "30d"] as const;
export type KnowledgeSpaceOverviewWindowKey = (typeof KnowledgeSpaceOverviewWindowKeys)[number];

export interface KnowledgeSpaceOverviewStatsWindow {
  readonly answerRate: number;
  readonly answeredQueryCount: number;
  readonly queryCount: number;
  readonly since: string;
}

export interface KnowledgeSpaceOverviewStats {
  readonly current: {
    readonly freshSourceCount: number;
    readonly knowledgeCount: number;
    readonly latestSourceSyncAt?: string | undefined;
    readonly linkedAppCount: number;
    readonly sourceCount: number;
    readonly staleSourceCount: number;
  };
  readonly generatedAt: string;
  readonly knowledgeSpaceId: string;
  readonly windows: Readonly<
    Record<KnowledgeSpaceOverviewWindowKey, KnowledgeSpaceOverviewStatsWindow>
  >;
}

export const KnowledgeSpaceAttentionRuleIds = [
  "stale-source",
  "failed-document",
  "low-quality-query",
  "permission-readiness",
  "model-readiness",
] as const;
export type KnowledgeSpaceAttentionRuleId = (typeof KnowledgeSpaceAttentionRuleIds)[number];
export type KnowledgeSpaceAttentionSeverity = "critical" | "warning" | "info";
export type KnowledgeSpaceAttentionStatus = "active" | "dismissed" | "resolved";

export interface KnowledgeSpaceAttentionIssue {
  readonly action: {
    readonly kind: "open-resource" | "review-permissions" | "review-models";
    readonly resourceId?: string | undefined;
    readonly resourceType: "knowledge-space" | "document" | "source" | "failed-query";
  };
  readonly dismissedUntil?: string | undefined;
  readonly evidence: readonly {
    readonly code: string;
    readonly observedAt: string;
    readonly value?: number | string | undefined;
  }[];
  readonly issueKey: string;
  readonly knowledgeSpaceId: string;
  readonly requiredPermissionScope: readonly string[];
  readonly resource: {
    readonly id: string;
    readonly type: "knowledge-space" | "document" | "source" | "failed-query";
  };
  readonly revision: number;
  readonly ruleId: KnowledgeSpaceAttentionRuleId;
  readonly severity: KnowledgeSpaceAttentionSeverity;
  readonly status: KnowledgeSpaceAttentionStatus;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ListKnowledgeSpaceAttentionInput {
  readonly candidateGrants: readonly string[];
  readonly includeDismissed?: boolean | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly now: string;
  readonly staleBefore: string;
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceOverviewPermissionBinding {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly candidateGrants: readonly string[];
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
}

export interface TransitionKnowledgeSpaceAttentionInput {
  readonly actorSubjectId: string;
  readonly candidateGrants: readonly string[];
  readonly dismissedUntil?: string | undefined;
  readonly expectedRevision: number;
  readonly issueKey: string;
  readonly knowledgeSpaceId: string;
  readonly now: string;
  readonly permission: KnowledgeSpaceOverviewPermissionBinding;
  readonly status: KnowledgeSpaceAttentionStatus;
  readonly tenantId: string;
}

export const KnowledgeSpaceHealthStates = [
  "healthy",
  "degraded",
  "unavailable",
  "unknown",
] as const;
export type KnowledgeSpaceHealthState = (typeof KnowledgeSpaceHealthStates)[number];

export interface KnowledgeSpaceProductHealthComponent {
  readonly codes: readonly string[];
  readonly state: KnowledgeSpaceHealthState;
}

export interface KnowledgeSpaceProductHealth {
  readonly components: {
    readonly index: KnowledgeSpaceProductHealthComponent;
    readonly ingestion: KnowledgeSpaceProductHealthComponent;
    readonly profilePublication: KnowledgeSpaceProductHealthComponent;
    readonly queryAvailability: KnowledgeSpaceProductHealthComponent;
    readonly sourceFreshness: KnowledgeSpaceProductHealthComponent;
    readonly workerReadiness: KnowledgeSpaceProductHealthComponent;
  };
  readonly generatedAt: string;
  readonly knowledgeSpaceId: string;
  readonly state: KnowledgeSpaceHealthState;
}

export interface KnowledgeSpaceOverviewRepository {
  appendActivity(input: AppendKnowledgeSpaceActivityInput): Promise<KnowledgeSpaceActivityEvent>;
  getHealth(input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly staleBefore: string;
    readonly tenantId: string;
    readonly workerStaleBefore: string;
  }): Promise<KnowledgeSpaceProductHealth>;
  getStats(input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly tenantId: string;
  }): Promise<KnowledgeSpaceOverviewStats>;
  listActivity(input: ListKnowledgeSpaceActivityInput): Promise<ListKnowledgeSpaceActivityResult>;
  listAttention(
    input: ListKnowledgeSpaceAttentionInput,
  ): Promise<readonly KnowledgeSpaceAttentionIssue[]>;
  transitionAttention(
    input: TransitionKnowledgeSpaceAttentionInput,
  ): Promise<KnowledgeSpaceAttentionIssue | null>;
}

export class KnowledgeSpaceOverviewLimitError extends Error {
  constructor(readonly maxLimit: number) {
    super(`Knowledge-space Overview limit exceeds ${maxLimit}`);
    this.name = "KnowledgeSpaceOverviewLimitError";
  }
}

export class KnowledgeSpaceAttentionRevisionConflictError extends Error {
  constructor() {
    super("Knowledge-space attention revision conflict");
    this.name = "KnowledgeSpaceAttentionRevisionConflictError";
  }
}

export function createInMemoryKnowledgeSpaceOverviewRepository(options: {
  readonly generateId?: (() => string) | undefined;
  readonly maxEvents: number;
  readonly maxListLimit: number;
}): KnowledgeSpaceOverviewRepository {
  const generateId = options.generateId ?? randomUUID;
  if (options.maxEvents < 1 || options.maxListLimit < 1) {
    throw new Error("Knowledge-space Overview repository bounds must be positive");
  }
  const events = new Map<string, KnowledgeSpaceActivityEvent>();
  const attention = new Map<string, KnowledgeSpaceAttentionIssue>();

  return {
    appendActivity: async (input) => {
      const event = normalizeActivity(input, input.id ?? generateId());
      const existing = events.get(event.id);
      if (existing) {
        if (!sameActivity(existing, event)) {
          throw new Error("Activity idempotency key was reused with different content or scope");
        }
        return cloneEvent(existing);
      }
      if (events.size >= options.maxEvents) {
        throw new Error("Knowledge-space activity capacity exceeded");
      }
      events.set(event.id, event);
      return cloneEvent(event);
    },
    getHealth: async (input) => {
      const failed = [...events.values()].filter(
        (event) =>
          event.tenantId === input.tenantId &&
          event.knowledgeSpaceId === input.knowledgeSpaceId &&
          event.result === "failure" &&
          Date.parse(event.occurredAt) >= Date.parse(input.workerStaleBefore),
      );
      const state: KnowledgeSpaceHealthState = failed.length > 0 ? "degraded" : "unknown";
      const component = { codes: [] as string[], state: "unknown" as const };
      return {
        components: {
          index: component,
          ingestion: failed.some((event) => event.action === "document.failed")
            ? { codes: ["INGESTION_FAILURE_PRESENT"], state: "degraded" }
            : component,
          profilePublication: component,
          queryAvailability: component,
          sourceFreshness: component,
          workerReadiness: failed.some((event) => event.action === "worker.failed")
            ? { codes: ["WORKER_FAILURE_PRESENT"], state: "degraded" }
            : component,
        },
        generatedAt: input.now,
        knowledgeSpaceId: input.knowledgeSpaceId,
        state,
      };
    },
    getStats: async (input) =>
      statsFromEvents(
        [...events.values()].filter(
          (event) =>
            event.tenantId === input.tenantId &&
            event.knowledgeSpaceId === input.knowledgeSpaceId &&
            candidatePermissionScopeAllows(event.requiredPermissionScope, input.candidateGrants),
        ),
        input.knowledgeSpaceId,
        input.now,
      ),
    listActivity: async (input) => {
      validateLimit(input.limit, options.maxListLimit);
      const sorted = [...events.values()]
        .filter(
          (event) =>
            event.tenantId === input.tenantId &&
            event.knowledgeSpaceId === input.knowledgeSpaceId &&
            candidatePermissionScopeAllows(event.requiredPermissionScope, input.candidateGrants),
        )
        .filter((event) => !input.action || event.action === input.action)
        .filter((event) => !input.resourceType || event.resource.type === input.resourceType)
        .filter((event) => !input.result || event.result === input.result)
        .filter((event) => !input.from || event.occurredAt >= input.from)
        .filter((event) => !input.to || event.occurredAt <= input.to)
        .filter(
          (event) =>
            !input.cursor ||
            event.occurredAt < input.cursor.occurredAt ||
            (event.occurredAt === input.cursor.occurredAt && event.id < input.cursor.id),
        )
        .sort(compareActivity)
        .slice(0, input.limit + 1);
      const items = sorted.slice(0, input.limit).map(cloneEvent);
      const tail = items.at(-1);
      return {
        items,
        ...(sorted.length > input.limit && tail
          ? { nextCursor: { id: tail.id, occurredAt: tail.occurredAt } }
          : {}),
      };
    },
    listAttention: async (input) => {
      validateLimit(input.limit, options.maxListLimit);
      return [...attention.values()]
        .filter(
          (issue) =>
            issue.knowledgeSpaceId === input.knowledgeSpaceId &&
            candidatePermissionScopeAllows(issue.requiredPermissionScope, input.candidateGrants),
        )
        .filter(
          (issue) =>
            issue.status === "active" ||
            (issue.status === "dismissed" &&
              issue.dismissedUntil !== undefined &&
              issue.dismissedUntil <= input.now) ||
            input.includeDismissed === true,
        )
        .slice(0, input.limit)
        .map(cloneIssue);
    },
    transitionAttention: async (input) => {
      assertOverviewPermissionBinding(input);
      const existing = attention.get(scopedAttentionKey(input));
      if (!existing) return null;
      if (existing.revision !== input.expectedRevision) {
        throw new KnowledgeSpaceAttentionRevisionConflictError();
      }
      const updated: KnowledgeSpaceAttentionIssue = {
        ...existing,
        ...(input.status === "dismissed" && input.dismissedUntil
          ? { dismissedUntil: input.dismissedUntil }
          : { dismissedUntil: undefined }),
        revision: existing.revision + 1,
        status: input.status,
        updatedAt: input.now,
      };
      attention.set(scopedAttentionKey(input), updated);
      return cloneIssue(updated);
    },
  };
}

function assertOverviewPermissionBinding(input: TransitionKnowledgeSpaceAttentionInput): void {
  if (
    input.permission.requestedBySubjectId !== input.actorSubjectId ||
    !sameStringSet(input.permission.candidateGrants, input.candidateGrants)
  ) {
    throw new Error("Knowledge-space Overview permission binding is invalid");
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return (
    expected.size === left.length &&
    new Set(right).size === right.length &&
    right.every((value) => expected.has(value))
  );
}

const SAFE_ACTIVITY_DETAIL_KEYS = new Set([
  "count",
  "documentType",
  "durationMs",
  "mode",
  "providerId",
  "reasonCode",
  "statusCode",
]);

export function sanitizeKnowledgeSpaceActivityDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, boolean | number | string>> {
  const safe: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (!SAFE_ACTIVITY_DETAIL_KEYS.has(key)) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    if (typeof value === "string" && value.length > 160) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    safe[key] = value;
  }
  return safe;
}

export function encodeKnowledgeSpaceActivityCursor(cursor: KnowledgeSpaceActivityCursor): string {
  return `${encodeURIComponent(cursor.occurredAt)}|${encodeURIComponent(cursor.id)}`;
}

export function decodeKnowledgeSpaceActivityCursor(value: string): KnowledgeSpaceActivityCursor {
  const [occurredAt, id, extra] = value.split("|");
  if (!occurredAt || !id || extra !== undefined) throw new Error("Invalid activity cursor");
  const decodedAt = decodeURIComponent(occurredAt);
  const decodedId = decodeURIComponent(id);
  if (Number.isNaN(Date.parse(decodedAt)) || !decodedId) throw new Error("Invalid activity cursor");
  return { id: decodedId, occurredAt: decodedAt };
}

export function knowledgeSpaceAttentionIssueKey(
  ruleId: KnowledgeSpaceAttentionRuleId,
  resourceType: KnowledgeSpaceAttentionIssue["resource"]["type"],
  resourceId: string,
): string {
  return `${ruleId}:${resourceType}:${resourceId}`;
}

/** Stable UUID used to make activity appends idempotent across worker/HTTP retries. */
export function deterministicKnowledgeSpaceActivityId(...parts: readonly string[]): string {
  const bytes = Buffer.from(
    createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeActivity(
  input: AppendKnowledgeSpaceActivityInput,
  id: string,
): KnowledgeSpaceActivityEvent {
  if (
    !input.tenantId ||
    !input.knowledgeSpaceId ||
    !id ||
    Number.isNaN(Date.parse(input.occurredAt))
  ) {
    throw new Error("Knowledge-space activity scope, id and occurredAt are required");
  }
  if (input.actor.type === "member" && !input.actor.id) {
    throw new Error("Member activity requires an actor id");
  }
  return {
    ...input,
    actor: { ...input.actor },
    details: sanitizeKnowledgeSpaceActivityDetails(input.details),
    id,
    requiredPermissionScope: [...new Set(input.requiredPermissionScope)].sort(),
    resource: { ...input.resource },
  };
}

function statsFromEvents(
  events: readonly KnowledgeSpaceActivityEvent[],
  knowledgeSpaceId: string,
  now: string,
): KnowledgeSpaceOverviewStats {
  const nowMs = Date.parse(now);
  const windows = Object.fromEntries(
    (
      [
        ["24h", 24 * 60 * 60_000],
        ["7d", 7 * 24 * 60 * 60_000],
        ["30d", 30 * 24 * 60 * 60_000],
      ] as const
    ).map(([key, duration]) => {
      const since = new Date(nowMs - duration).toISOString();
      const requestedAtByQuery = new Map<string, string>();
      for (const event of events) {
        if (
          event.action !== "query.requested" ||
          event.occurredAt < since ||
          event.resource.id === undefined
        ) {
          continue;
        }
        const existing = requestedAtByQuery.get(event.resource.id);
        if (!existing || event.occurredAt < existing) {
          requestedAtByQuery.set(event.resource.id, event.occurredAt);
        }
      }
      const answeredQueries = new Set<string>();
      for (const event of events) {
        if (
          event.action !== "query.completed" ||
          event.occurredAt < since ||
          event.resource.id === undefined
        ) {
          continue;
        }
        const requestedAt = requestedAtByQuery.get(event.resource.id);
        if (requestedAt && requestedAt <= event.occurredAt) {
          answeredQueries.add(event.resource.id);
        }
      }
      const queryCount = requestedAtByQuery.size;
      const answeredQueryCount = answeredQueries.size;
      return [
        key,
        {
          answerRate: queryCount === 0 ? 0 : answeredQueryCount / queryCount,
          answeredQueryCount,
          queryCount,
          since,
        },
      ];
    }),
  ) as unknown as KnowledgeSpaceOverviewStats["windows"];
  return {
    current: {
      freshSourceCount: 0,
      knowledgeCount: 0,
      linkedAppCount: 0,
      sourceCount: 0,
      staleSourceCount: 0,
    },
    generatedAt: now,
    knowledgeSpaceId,
    windows,
  };
}

function compareActivity(left: KnowledgeSpaceActivityEvent, right: KnowledgeSpaceActivityEvent) {
  return right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id);
}

function sameActivity(left: KnowledgeSpaceActivityEvent, right: KnowledgeSpaceActivityEvent) {
  const { occurredAt: _leftOccurredAt, ...leftIdentity } = left;
  const { occurredAt: _rightOccurredAt, ...rightIdentity } = right;
  return stableJson(leftIdentity) === stableJson(rightIdentity);
}

function scopedAttentionKey(input: {
  readonly issueKey: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}) {
  return `${input.tenantId}\u0000${input.knowledgeSpaceId}\u0000${input.issueKey}`;
}

function cloneEvent(event: KnowledgeSpaceActivityEvent): KnowledgeSpaceActivityEvent {
  return {
    ...event,
    actor: { ...event.actor },
    details: { ...event.details },
    requiredPermissionScope: [...event.requiredPermissionScope],
    resource: { ...event.resource },
  };
}

function cloneIssue(issue: KnowledgeSpaceAttentionIssue): KnowledgeSpaceAttentionIssue {
  return {
    ...issue,
    action: { ...issue.action },
    evidence: issue.evidence.map((item) => ({ ...item })),
    requiredPermissionScope: [...issue.requiredPermissionScope],
    resource: { ...issue.resource },
  };
}

function validateLimit(limit: number, max: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Overview limit must be positive");
  if (limit > max) throw new KnowledgeSpaceOverviewLimitError(max);
}
