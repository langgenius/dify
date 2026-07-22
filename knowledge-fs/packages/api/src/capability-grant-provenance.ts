import { createHash } from "node:crypto";

import { stableJson } from "@knowledge/core";

export type CapabilityCallerKind =
  | "agent"
  | "interactive"
  | "internal_worker"
  | "mcp"
  | "service"
  | "workflow";

export interface CapabilityAuthorizationRevision {
  readonly credentialRevision: number | null;
  readonly externalAccessEpoch: number;
  readonly membershipEpoch: number;
  readonly spaceAclEpoch: number;
}

export interface CapabilityGrantResource {
  readonly id: string;
  readonly parentId?: string | null | undefined;
  readonly type: string;
}

export interface AdmitCapabilityGrantInput {
  readonly action: string;
  readonly actorId: string;
  readonly authzRevision: CapabilityAuthorizationRevision;
  readonly callerKind: CapabilityCallerKind;
  readonly contentPolicyRevision: number;
  readonly contentScopeIds: readonly string[];
  readonly expiresAt: string;
  readonly grantId: string;
  readonly issuedAt: string;
  /** One-way digest of the JWT identifier. The original JWT and jti are never persisted. */
  readonly jtiHash: string;
  readonly knowledgeSpaceId: string;
  readonly resource: CapabilityGrantResource;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface CapabilityGrantProvenance extends AdmitCapabilityGrantInput {
  readonly admittedAt: string;
  readonly highestRevokeSequence: number;
  readonly revision: number;
  readonly revokeReasonCode?: string | undefined;
  readonly revokedAt?: string | undefined;
  readonly state: "active" | "revoked";
  readonly updatedAt: string;
}

export interface CapabilityGrantScope {
  readonly grantId: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ApplyCapabilityGrantRevokeInput extends CapabilityGrantScope {
  readonly eventId: string;
  readonly reasonCode: string;
  readonly revokeSequence: number;
}

export interface ApplyCapabilitySpaceFenceInput {
  readonly eventId: string;
  readonly knowledgeSpaceId: string;
  readonly reasonCode: string;
  readonly revokeSequence: number;
  readonly tenantId: string;
  readonly tombstoned: boolean;
}

export interface CapabilityGrantRevokeResult {
  readonly applied: boolean;
  readonly highestRevokeSequence: number;
  readonly state: "active" | "revoked";
}

export interface CapabilitySpaceFenceResult {
  readonly applied: boolean;
  readonly highestRevokeSequence: number;
  readonly tombstoned: boolean;
}

export interface CapabilityGrantProvenanceRepository {
  admit(input: AdmitCapabilityGrantInput): Promise<CapabilityGrantProvenance>;
  applyGrantRevoke(input: ApplyCapabilityGrantRevokeInput): Promise<CapabilityGrantRevokeResult>;
  applySpaceFence(input: ApplyCapabilitySpaceFenceInput): Promise<CapabilitySpaceFenceResult>;
  assertPublicationAllowed(scope: CapabilityGrantScope): Promise<void>;
  get(scope: CapabilityGrantScope): Promise<CapabilityGrantProvenance | null>;
}

export interface InMemoryCapabilityGrantProvenanceRepositoryOptions {
  readonly now?: (() => string) | undefined;
}

export class CapabilityGrantConflictError extends Error {
  constructor() {
    super("Capability grant id was already admitted with different immutable claims");
    this.name = "CapabilityGrantConflictError";
  }
}

export class CapabilityPublicationFencedError extends Error {
  constructor() {
    super("Capability publication is fenced");
    this.name = "CapabilityPublicationFencedError";
  }
}

export class CapabilityRevokeEventConflictError extends Error {
  constructor() {
    super("Capability revoke event id was reused with a different command");
    this.name = "CapabilityRevokeEventConflictError";
  }
}

interface StoredGrant {
  readonly claimsDigest: string;
  readonly provenance: CapabilityGrantProvenance;
}

interface StoredSpaceFence {
  readonly highestRevokeSequence: number;
  readonly reasonCode: string;
  readonly tombstoned: boolean;
}

/**
 * Durable authorization is represented by an immutable claims summary plus monotonic revocation
 * watermarks. Implementations must never persist the bearer JWT or its raw jti.
 */
export function createInMemoryCapabilityGrantProvenanceRepository({
  now = () => new Date().toISOString(),
}: InMemoryCapabilityGrantProvenanceRepositoryOptions = {}): CapabilityGrantProvenanceRepository {
  const grants = new Map<string, StoredGrant>();
  const spaceFences = new Map<string, StoredSpaceFence>();
  const receivedEvents = new Map<string, string>();

  return {
    admit: async (input) => {
      const normalized = normalizeCapabilityGrantAdmission(input);
      const key = grantKey(normalized);
      const digest = capabilityGrantClaimsDigest(normalized);
      const existing = grants.get(key);
      if (existing) {
        if (existing.claimsDigest !== digest) throw new CapabilityGrantConflictError();
        return cloneProvenance(existing.provenance);
      }

      const timestamp = now();
      const provenance: CapabilityGrantProvenance = {
        ...normalized,
        admittedAt: timestamp,
        highestRevokeSequence: 0,
        revision: 1,
        state: "active",
        updatedAt: timestamp,
      };
      grants.set(key, { claimsDigest: digest, provenance });
      return cloneProvenance(provenance);
    },
    applyGrantRevoke: async (input) => {
      validateCapabilityGrantRevoke(input);
      const key = grantKey(input);
      const fingerprint = revokeEventFingerprint("grant", input);
      const duplicate = isEventReplay(receivedEvents, input.eventId, fingerprint);
      const existing = grants.get(key);
      if (!existing) throw new CapabilityPublicationFencedError();
      if (duplicate || input.revokeSequence <= existing.provenance.highestRevokeSequence) {
        receivedEvents.set(input.eventId, fingerprint);
        return grantRevokeResult(existing.provenance, false);
      }

      const timestamp = now();
      const provenance: CapabilityGrantProvenance = {
        ...existing.provenance,
        highestRevokeSequence: input.revokeSequence,
        revision: existing.provenance.revision + 1,
        revokeReasonCode: input.reasonCode,
        revokedAt: timestamp,
        state: "revoked",
        updatedAt: timestamp,
      };
      grants.set(key, { ...existing, provenance });
      receivedEvents.set(input.eventId, fingerprint);
      return grantRevokeResult(provenance, true);
    },
    applySpaceFence: async (input) => {
      validateCapabilitySpaceFence(input);
      const key = spaceKey(input);
      const fingerprint = revokeEventFingerprint("space", input);
      const duplicate = isEventReplay(receivedEvents, input.eventId, fingerprint);
      const existing = spaceFences.get(key) ?? {
        highestRevokeSequence: 0,
        reasonCode: "not_fenced",
        tombstoned: false,
      };
      if (duplicate || input.revokeSequence <= existing.highestRevokeSequence) {
        receivedEvents.set(input.eventId, fingerprint);
        return spaceFenceResult(existing, false);
      }

      const fence: StoredSpaceFence = {
        highestRevokeSequence: input.revokeSequence,
        reasonCode: input.reasonCode,
        tombstoned: input.tombstoned,
      };
      spaceFences.set(key, fence);
      receivedEvents.set(input.eventId, fingerprint);
      return spaceFenceResult(fence, true);
    },
    assertPublicationAllowed: async (scope) => {
      validateCapabilityGrantScope(scope);
      const grant = grants.get(grantKey(scope))?.provenance;
      const fence = spaceFences.get(spaceKey(scope));
      if (!grant || grant.state !== "active" || fence?.tombstoned === true) {
        throw new CapabilityPublicationFencedError();
      }
    },
    get: async (scope) => {
      validateCapabilityGrantScope(scope);
      const grant = grants.get(grantKey(scope));
      return grant ? cloneProvenance(grant.provenance) : null;
    },
  };
}

export function normalizeCapabilityGrantAdmission(
  input: AdmitCapabilityGrantInput,
): AdmitCapabilityGrantInput {
  validateCapabilityGrantScope(input);
  for (const [field, value] of [
    ["action", input.action],
    ["actorId", input.actorId],
    ["callerKind", input.callerKind],
    ["expiresAt", input.expiresAt],
    ["issuedAt", input.issuedAt],
    ["jtiHash", input.jtiHash],
    ["resource.id", input.resource.id],
    ["resource.type", input.resource.type],
    ["subjectId", input.subjectId],
    ["traceId", input.traceId],
  ] as const) {
    requiredString(value, `Capability grant ${field}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.jtiHash)) {
    throw new Error("Capability grant jtiHash must be a SHA-256 digest");
  }
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("Capability grant time window is invalid");
  }
  validateRevision(input.contentPolicyRevision, "contentPolicyRevision");
  validateRevision(input.authzRevision.externalAccessEpoch, "externalAccessEpoch");
  validateRevision(input.authzRevision.membershipEpoch, "membershipEpoch");
  validateRevision(input.authzRevision.spaceAclEpoch, "spaceAclEpoch");
  if (input.authzRevision.credentialRevision !== null) {
    validateRevision(input.authzRevision.credentialRevision, "credentialRevision");
  }
  const contentScopeIds = [...new Set(input.contentScopeIds.map((value) => value.trim()))].sort();
  if (contentScopeIds.some((value) => !value)) {
    throw new Error("Capability grant contentScopeIds must not contain empty values");
  }
  return {
    ...input,
    action: input.action.trim(),
    actorId: input.actorId.trim(),
    contentScopeIds,
    grantId: input.grantId.trim(),
    jtiHash: input.jtiHash.trim(),
    knowledgeSpaceId: input.knowledgeSpaceId.trim(),
    resource: {
      id: input.resource.id.trim(),
      ...(input.resource.parentId === undefined
        ? {}
        : { parentId: input.resource.parentId?.trim() ?? null }),
      type: input.resource.type.trim(),
    },
    subjectId: input.subjectId.trim(),
    tenantId: input.tenantId.trim(),
    traceId: input.traceId.trim(),
  };
}

export function validateCapabilityGrantScope(scope: CapabilityGrantScope): void {
  requiredString(scope.tenantId, "Capability grant tenantId");
  requiredString(scope.knowledgeSpaceId, "Capability grant knowledgeSpaceId");
  requiredString(scope.grantId, "Capability grant grantId");
}

export function validateCapabilityGrantRevoke(input: ApplyCapabilityGrantRevokeInput): void {
  validateCapabilityGrantScope(input);
  validateEvent(input.eventId, input.reasonCode, input.revokeSequence);
}

export function validateCapabilitySpaceFence(input: ApplyCapabilitySpaceFenceInput): void {
  requiredString(input.tenantId, "Capability space fence tenantId");
  requiredString(input.knowledgeSpaceId, "Capability space fence knowledgeSpaceId");
  validateEvent(input.eventId, input.reasonCode, input.revokeSequence);
}

function validateEvent(eventId: string, reasonCode: string, revokeSequence: number): void {
  requiredString(eventId, "Capability revoke eventId");
  requiredString(reasonCode, "Capability revoke reasonCode");
  if (!Number.isSafeInteger(revokeSequence) || revokeSequence < 1) {
    throw new Error("Capability revoke sequence must be a positive integer");
  }
}

function validateRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Capability grant ${field} must be a nonnegative integer`);
  }
}

function requiredString(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required`);
}

export function capabilityGrantClaimsDigest(input: AdmitCapabilityGrantInput): string {
  return `sha256:${createHash("sha256").update(stableJson(input)).digest("hex")}`;
}

function grantKey(scope: CapabilityGrantScope): string {
  return `${scope.tenantId}\u0000${scope.knowledgeSpaceId}\u0000${scope.grantId}`;
}

function spaceKey(scope: Pick<CapabilityGrantScope, "knowledgeSpaceId" | "tenantId">): string {
  return `${scope.tenantId}\u0000${scope.knowledgeSpaceId}`;
}

function revokeEventFingerprint(
  kind: "grant" | "space",
  input: ApplyCapabilityGrantRevokeInput | ApplyCapabilitySpaceFenceInput,
): string {
  return stableJson({ kind, ...input });
}

function isEventReplay(
  receivedEvents: ReadonlyMap<string, string>,
  eventId: string,
  fingerprint: string,
): boolean {
  const existing = receivedEvents.get(eventId);
  if (existing === undefined) return false;
  if (existing !== fingerprint) throw new CapabilityRevokeEventConflictError();
  return true;
}

function grantRevokeResult(
  provenance: CapabilityGrantProvenance,
  applied: boolean,
): CapabilityGrantRevokeResult {
  return {
    applied,
    highestRevokeSequence: provenance.highestRevokeSequence,
    state: provenance.state,
  };
}

function spaceFenceResult(fence: StoredSpaceFence, applied: boolean): CapabilitySpaceFenceResult {
  return {
    applied,
    highestRevokeSequence: fence.highestRevokeSequence,
    tombstoned: fence.tombstoned,
  };
}

function cloneProvenance(provenance: CapabilityGrantProvenance): CapabilityGrantProvenance {
  return {
    ...provenance,
    authzRevision: { ...provenance.authzRevision },
    contentScopeIds: [...provenance.contentScopeIds],
    resource: { ...provenance.resource },
  };
}
