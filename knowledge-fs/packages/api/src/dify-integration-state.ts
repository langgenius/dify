import { createHash } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const PRE_ACTIVATION_INTERNAL_ACTIONS: ReadonlySet<string> = new Set([
  "capability_grants.revoke",
  "dify_integration.activate",
  "dify_integration.freeze",
  "knowledge_spaces.delete",
  "knowledge_spaces.list",
  "knowledge_spaces.provision",
]);

export interface DifyIntegrationActivationInput {
  readonly activationId: string;
  readonly activationRevision: number;
  readonly namespaceId: string;
  readonly sourceRevisionDigest: string;
}

export type DifyIntegrationActivationEvidence = Omit<
  DifyIntegrationActivationInput,
  "activationId"
>;

export interface DifyIntegrationState extends DifyIntegrationActivationInput {
  readonly activatedAt: string;
  readonly updatedAt: string;
}

export interface DifyIntegrationActivationResult {
  readonly applied: boolean;
  readonly replayed: boolean;
  readonly state: DifyIntegrationState;
}

export interface DifyIntegrationStateRepository {
  activate(input: DifyIntegrationActivationInput): Promise<DifyIntegrationActivationResult>;
  get(namespaceId: string): Promise<DifyIntegrationState | null>;
}

export type DifyIntegrationActivationDecision =
  | {
      readonly kind: "insert";
      readonly result: DifyIntegrationActivationResult;
    }
  | {
      readonly kind: "replay";
      readonly result: DifyIntegrationActivationResult;
    }
  | {
      readonly kind: "update";
      readonly previousRevision: number;
      readonly result: DifyIntegrationActivationResult;
    };

export class DifyIntegrationActivationConflictError extends Error {
  readonly code = "DIFY_INTEGRATION_ACTIVATION_CONFLICT";

  constructor() {
    super("Dify integration activation revision or evidence conflicts with durable state");
    this.name = "DifyIntegrationActivationConflictError";
  }
}

/**
 * Bind the activation command to its exact tenant/revision/final-delta evidence envelope.
 * The matching Dify implementation uses sorted, compact UTF-8 JSON with the same three fields.
 */
export function computeDifyIntegrationActivationId(
  evidence: DifyIntegrationActivationEvidence,
): string {
  requireActivationRevision(evidence.activationRevision);
  requireIdentifier(evidence.namespaceId, "namespaceId");
  requireSourceRevisionDigest(evidence.sourceRevisionDigest);
  const canonicalJson = JSON.stringify({
    activationRevision: evidence.activationRevision,
    namespaceId: evidence.namespaceId,
    sourceRevisionDigest: evidence.sourceRevisionDigest,
  });
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}

/** Decide a monotonic, never-deactivated transition before the persistence adapter mutates state. */
export function decideDifyIntegrationActivation(
  existing: DifyIntegrationState | null,
  input: DifyIntegrationActivationInput,
  now: string,
): DifyIntegrationActivationDecision {
  validateActivationInput(input);
  requireTimestamp(now);
  if (!existing) {
    return {
      kind: "insert",
      result: {
        applied: true,
        replayed: false,
        state: { ...input, activatedAt: now, updatedAt: now },
      },
    };
  }
  assertDifyIntegrationState(existing);
  if (existing.namespaceId !== input.namespaceId) {
    throw new DifyIntegrationActivationConflictError();
  }
  if (input.activationRevision < existing.activationRevision) {
    throw new DifyIntegrationActivationConflictError();
  }
  if (input.activationRevision === existing.activationRevision) {
    if (
      input.activationId !== existing.activationId ||
      input.sourceRevisionDigest !== existing.sourceRevisionDigest
    ) {
      throw new DifyIntegrationActivationConflictError();
    }
    return {
      kind: "replay",
      result: { applied: false, replayed: true, state: existing },
    };
  }
  return {
    kind: "update",
    previousRevision: existing.activationRevision,
    result: {
      applied: true,
      replayed: false,
      state: {
        ...input,
        activatedAt: existing.activatedAt,
        updatedAt: now,
      },
    },
  };
}

/** Reject corrupt durable state before it can select the Workspace authorization source. */
export function assertDifyIntegrationState(state: DifyIntegrationState): void {
  validateActivationInput(state);
  requireTimestamp(state.activatedAt);
  requireTimestamp(state.updatedAt);
}

/**
 * Enforce exactly one authorization source per Workspace. Internal lifecycle/recovery commands may
 * run before activation so provision/delete/revoke lost-ACK reconciliation remains possible.
 */
export function createDifyIntegrationStateMiddleware(
  repository: DifyIntegrationStateRepository,
): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const subject = context.get("subject");
    if (!subject) {
      await next();
      return;
    }
    const grant = context.get("capabilityV2Grant");
    if (grant && grant.namespaceId !== subject.tenantId) {
      return context.json({ code: "DIFY_INTEGRATION_SCOPE_MISMATCH", error: "Forbidden" }, 403);
    }
    if (grant && isPreActivationInternalAction(grant)) {
      await next();
      return;
    }
    const state = await repository.get(subject.tenantId);
    const admitted = grant ? state !== null : state === null;
    if (!admitted) {
      return context.json(
        {
          code: grant ? "DIFY_INTEGRATION_NOT_ACTIVE" : "DIFY_INTEGRATION_LEGACY_AUTH_DISABLED",
          error: "Forbidden",
        },
        403,
      );
    }
    await next();
  };
}

function isPreActivationInternalAction(grant: DifyCapabilityV2SanitizedGrant): boolean {
  return (
    grant.callerKind === "internal_worker" &&
    grant.resource.type === "namespace" &&
    grant.resource.id === grant.namespaceId &&
    PRE_ACTIVATION_INTERNAL_ACTIONS.has(grant.action)
  );
}

function validateActivationInput(input: DifyIntegrationActivationInput): void {
  requireIdentifier(input.activationId, "activationId");
  const expectedActivationId = computeDifyIntegrationActivationId(input);
  if (input.activationId !== expectedActivationId) {
    throw new TypeError("activationId must match the canonical activation evidence digest");
  }
}

function requireActivationRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    throw new TypeError("activationRevision must be a positive safe integer");
  }
}

function requireSourceRevisionDigest(value: string): void {
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
    throw new TypeError("Integration activation timestamp must be ISO-8601 compatible");
  }
}
