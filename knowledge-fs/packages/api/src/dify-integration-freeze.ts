import { createHash } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface DifyIntegrationFreezeEvidence {
  readonly freezeRevision: number;
  readonly namespaceId: string;
  readonly sourceRevisionDigest: string;
  readonly sourceTaskWatermark: number;
}

export interface DifyIntegrationFreezeInput extends DifyIntegrationFreezeEvidence {
  readonly freezeId: string;
}

export interface DifyIntegrationFreezeState extends DifyIntegrationFreezeInput {
  readonly frozenAt: string;
  readonly updatedAt: string;
}

export interface DifyIntegrationFreezeResult {
  readonly applied: boolean;
  readonly replayed: boolean;
  readonly state: DifyIntegrationFreezeState;
}

export interface DifyIntegrationFreezeRepository {
  freeze(input: DifyIntegrationFreezeInput): Promise<DifyIntegrationFreezeResult>;
  get(namespaceId: string): Promise<DifyIntegrationFreezeState | null>;
}

export type DifyIntegrationFreezeDecision =
  | { readonly kind: "insert"; readonly result: DifyIntegrationFreezeResult }
  | { readonly kind: "replay"; readonly result: DifyIntegrationFreezeResult }
  | {
      readonly kind: "update";
      readonly previousRevision: number;
      readonly result: DifyIntegrationFreezeResult;
    };

export interface LegacyAuthorizationTrafficMetric {
  readonly method: string;
  readonly routeKind: "access_policy" | "api_access" | "api_key" | "member";
}

export interface LegacyAuthorizationTrafficMetrics {
  record(metric: LegacyAuthorizationTrafficMetric): Promise<void> | void;
}

export class DifyIntegrationFreezeConflictError extends Error {
  readonly code = "DIFY_INTEGRATION_FREEZE_CONFLICT";

  constructor() {
    super("Dify integration freeze revision or evidence conflicts with durable state");
    this.name = "DifyIntegrationFreezeConflictError";
  }
}

/** Bind the maintenance freeze to the exact Workspace revision and task watermarks. */
export function computeDifyIntegrationFreezeId(evidence: DifyIntegrationFreezeEvidence): string {
  requirePositiveSafeInteger(evidence.freezeRevision, "freezeRevision");
  requireIdentifier(evidence.namespaceId, "namespaceId");
  requireDigest(evidence.sourceRevisionDigest);
  requireNonnegativeSafeInteger(evidence.sourceTaskWatermark, "sourceTaskWatermark");
  const canonicalJson = JSON.stringify({
    freezeRevision: evidence.freezeRevision,
    namespaceId: evidence.namespaceId,
    sourceRevisionDigest: evidence.sourceRevisionDigest,
    sourceTaskWatermark: evidence.sourceTaskWatermark,
  });
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}

/** Decide a monotonic freeze transition before a persistence adapter mutates state. */
export function decideDifyIntegrationFreeze(
  existing: DifyIntegrationFreezeState | null,
  input: DifyIntegrationFreezeInput,
  now: string,
): DifyIntegrationFreezeDecision {
  validateFreezeInput(input);
  requireTimestamp(now);
  if (!existing) {
    return {
      kind: "insert",
      result: {
        applied: true,
        replayed: false,
        state: { ...input, frozenAt: now, updatedAt: now },
      },
    };
  }
  assertDifyIntegrationFreezeState(existing);
  if (existing.namespaceId !== input.namespaceId || input.freezeRevision < existing.freezeRevision) {
    throw new DifyIntegrationFreezeConflictError();
  }
  if (input.freezeRevision === existing.freezeRevision) {
    if (
      input.freezeId !== existing.freezeId ||
      input.sourceRevisionDigest !== existing.sourceRevisionDigest ||
      input.sourceTaskWatermark !== existing.sourceTaskWatermark
    ) {
      throw new DifyIntegrationFreezeConflictError();
    }
    return {
      kind: "replay",
      result: { applied: false, replayed: true, state: existing },
    };
  }
  return {
    kind: "update",
    previousRevision: existing.freezeRevision,
    result: {
      applied: true,
      replayed: false,
      state: {
        ...input,
        frozenAt: existing.frozenAt,
        updatedAt: now,
      },
    },
  };
}

/** Reject corrupt durable freeze state before it can stop a Workspace write path. */
export function assertDifyIntegrationFreezeState(state: DifyIntegrationFreezeState): void {
  validateFreezeInput(state);
  requireTimestamp(state.frozenAt);
  requireTimestamp(state.updatedAt);
}

/**
 * Once a Workspace is frozen, legacy reads remain available for final-delta reconciliation while
 * every legacy mutation is stopped. Capability-v2 internal lifecycle traffic is not affected.
 */
export function createDifyIntegrationFreezeMiddleware(
  repository: DifyIntegrationFreezeRepository,
  metrics?: LegacyAuthorizationTrafficMetrics,
): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const subject = context.get("subject");
    if (!subject) {
      await next();
      return;
    }
    const grant = context.get("capabilityV2Grant");
    if (grant) {
      await next();
      return;
    }
    const metric = legacyAuthorizationTrafficMetric(context.req.method, context.req.path);
    if (metric) recordMetric(metrics, metric);
    const state = await repository.get(subject.tenantId);
    if (state && !isSafeMethod(context.req.method)) {
      return context.json(
        { code: "DIFY_INTEGRATION_MAINTENANCE_FROZEN", error: "Locked" },
        423,
      );
    }
    await next();
  };
}

export function legacyAuthorizationTrafficMetric(
  method: string,
  path: string,
): LegacyAuthorizationTrafficMetric | null {
  let routeKind: LegacyAuthorizationTrafficMetric["routeKind"] | null = null;
  if (/^\/knowledge-spaces\/[^/]+\/(?:access-bootstrap|access-policy)$/u.test(path)) {
    routeKind = "access_policy";
  } else if (/^\/knowledge-spaces\/[^/]+\/api-access$/u.test(path)) {
    routeKind = "api_access";
  } else if (/^\/knowledge-spaces\/[^/]+\/members(?:\/[^/]+)?$/u.test(path)) {
    routeKind = "member";
  } else if (/^\/knowledge-spaces\/[^/]+\/api-keys(?:\/[^/]+)?$/u.test(path)) {
    routeKind = "api_key";
  }
  return routeKind ? { method: method.toUpperCase(), routeKind } : null;
}

function validateFreezeInput(input: DifyIntegrationFreezeInput): void {
  requireIdentifier(input.freezeId, "freezeId");
  if (!SHA256_DIGEST.test(input.freezeId)) {
    throw new TypeError("freezeId must be a lowercase SHA-256 digest");
  }
  if (input.freezeId !== computeDifyIntegrationFreezeId(input)) {
    throw new TypeError("freezeId must match the canonical freeze evidence digest");
  }
}

function requirePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function requireNonnegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
}

function requireDigest(value: string): void {
  if (!SHA256_DIGEST.test(value)) {
    throw new TypeError("sourceRevisionDigest must be a lowercase SHA-256 digest");
  }
}

function requireIdentifier(value: string, field: string): void {
  if (value.length === 0 || value.length > 255 || value.trim() !== value) {
    throw new TypeError(`${field} must be a non-empty normalized identifier`);
  }
}

function requireTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError("Integration freeze timestamp must be ISO-8601 compatible");
  }
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function recordMetric(
  metrics: LegacyAuthorizationTrafficMetrics | undefined,
  metric: LegacyAuthorizationTrafficMetric,
): void {
  if (!metrics) return;
  try {
    const pending = metrics.record(metric);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Telemetry must never own authorization admission state.
  }
}
