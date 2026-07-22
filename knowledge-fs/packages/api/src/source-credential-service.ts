import { randomUUID } from "node:crypto";

import { redactSourceMetadata } from "./core-resource-response-schemas";
import type { CreateSourceInput, SourceRepository, UpdateSourceInput } from "./source-repository";
import { SourceVersionConflictError } from "./source-repository";
import type {
  SourceSecretLifecycleRef,
  SourceSecretLifecycleRepository,
} from "./source-retired-secret-cleanup";
import type { SourceSecretStore } from "./source-secret-store";

import type { Source } from "@knowledge/core";

export interface CreateSourceWithCredentialsInput
  extends Omit<CreateSourceInput, "credentialRef" | "id"> {
  readonly credentials?: Readonly<Record<string, unknown>> | undefined;
  readonly id?: string | undefined;
  readonly tenantId: string;
}

export interface RotateSourceCredentialsInput {
  readonly credentials: Readonly<Record<string, unknown>>;
  readonly expectedVersion: number;
  readonly knowledgeSpaceId: string;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface RevokeSourceCredentialsInput {
  readonly expectedVersion: number;
  readonly knowledgeSpaceId: string;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface ResolveSourceCredentialsInput {
  readonly source: Source;
  readonly tenantId: string;
}

export interface SourceCredentialService {
  create(input: CreateSourceWithCredentialsInput): Promise<Source>;
  resolve(input: ResolveSourceCredentialsInput): Promise<Source>;
  revoke(input: RevokeSourceCredentialsInput): Promise<Source | null>;
  rotate(input: RotateSourceCredentialsInput): Promise<Source | null>;
}

export class SourceCredentialUnavailableError extends Error {
  readonly code = "SOURCE_CREDENTIAL_UNAVAILABLE";

  constructor() {
    super("Source credentials are unavailable");
    this.name = "SourceCredentialUnavailableError";
  }
}

export class SourceCredentialMutationError extends Error {
  readonly code = "SOURCE_CREDENTIAL_MUTATION_FAILED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceCredentialMutationError";
  }
}

type SourceCredentialLifecycle = Pick<
  SourceSecretLifecycleRepository,
  "activateCreate" | "activateRotateAndRetire" | "getByRef" | "reserveStaged" | "withWriteAdmission"
>;

const stagedSecretRecoveryMs = 5 * 60 * 1_000;

/**
 * Moves credentials across the Source/SecretStore boundary. New writes never persist a secret in
 * Source.metadata. `resolve` materializes a short-lived clone for a connector call and fails closed
 * when a stored reference is missing or scope-bound decryption fails.
 */
export function createSourceCredentialService(input: {
  /** Kept under the compatibility name so existing application wiring need not change. */
  readonly retiredSecrets: SourceCredentialLifecycle;
  readonly generateCredentialRef?: (() => string) | undefined;
  readonly generateOperationId?: (() => string) | undefined;
  readonly generateSourceId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
  readonly secretStore: SourceSecretStore;
  readonly sources: SourceRepository;
}): SourceCredentialService {
  const generateSourceId = input.generateSourceId ?? randomUUID;
  const generateCredentialRef =
    input.generateCredentialRef ?? (() => `source-secret:v1:${randomUUID()}`);
  const generateOperationId = input.generateOperationId ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());

  return {
    create: async (rawInput) => {
      const sourceId = rawInput.id ?? generateSourceId();
      const legacyCredentials = readLegacyCredentials(rawInput.metadata);
      const credentials = rawInput.credentials ?? legacyCredentials;
      const metadata = redactSourceMetadata(rawInput.metadata ?? {});
      if (!credentials) {
        return input.sources.create({
          ...sourceCreateFields(rawInput),
          id: sourceId,
          metadata,
        });
      }

      const credentialRef = generateCredentialRef();
      const operationId = generateOperationId();
      const reservation = await input.retiredSecrets.reserveStaged({
        credentialRef,
        knowledgeSpaceId: rawInput.knowledgeSpaceId,
        operationId,
        purpose: "create",
        recoverAfter: stagedRecoverAfter(now()),
        sourceId,
        tenantId: rawInput.tenantId,
      });
      assertReservationScope(reservation, {
        credentialRef,
        knowledgeSpaceId: rawInput.knowledgeSpaceId,
        operationId,
        purpose: "create",
        sourceId,
        tenantId: rawInput.tenantId,
      });
      if (reservation.state === "active") {
        const committed = await recoverCommittedActivation({
          credentialRef,
          knowledgeSpaceId: rawInput.knowledgeSpaceId,
          lifecycle: input.retiredSecrets,
          operationId,
          purpose: "create",
          sourceId,
          sources: input.sources,
          tenantId: rawInput.tenantId,
        });
        if (committed) {
          return committed;
        }
        throw terminalReservationError();
      }
      if (reservation.state !== "staged") {
        throw terminalReservationError();
      }

      try {
        await input.retiredSecrets.withWriteAdmission(
          {
            knowledgeSpaceId: rawInput.knowledgeSpaceId,
            tenantId: rawInput.tenantId,
          },
          () =>
            putReservedSecret(input.secretStore, {
              credentialRef,
              credentials,
              knowledgeSpaceId: rawInput.knowledgeSpaceId,
              sourceId,
              tenantId: rawInput.tenantId,
            }),
        );
      } catch (error) {
        throw mutationFailure("Source credential persistence failed", error);
      }

      try {
        return await input.retiredSecrets.activateCreate({
          operationId,
          reservedCredentialRef: credentialRef,
          source: {
            ...sourceCreateFields(rawInput),
            id: sourceId,
            metadata,
          },
          tenantId: rawInput.tenantId,
        });
      } catch (error) {
        const committed = await recoverCommittedActivation({
          credentialRef,
          knowledgeSpaceId: rawInput.knowledgeSpaceId,
          lifecycle: input.retiredSecrets,
          operationId,
          purpose: "create",
          sourceId,
          sources: input.sources,
          tenantId: rawInput.tenantId,
        });
        if (committed) {
          return committed;
        }
        if (error instanceof SourceVersionConflictError) {
          throw error;
        }
        throw mutationFailure("Source credential activation failed", error);
      }
    },
    resolve: async ({ source, tenantId }) => {
      if (source.credentialRef) {
        const stored = await input.secretStore.get({
          knowledgeSpaceId: source.knowledgeSpaceId,
          ref: source.credentialRef,
          sourceId: source.id,
          tenantId,
        });
        if (!stored) {
          throw new SourceCredentialUnavailableError();
        }
        return cloneWithEphemeralCredentials(source, stored.credentials);
      }

      // Temporary dual-read for legacy rows only. New create/update paths strip these values, and
      // the durable backfill removes them from existing rows before this fallback is retired.
      const legacyCredentials = readLegacyCredentials(source.metadata);
      return legacyCredentials ? cloneWithEphemeralCredentials(source, legacyCredentials) : source;
    },
    revoke: async ({ expectedVersion, knowledgeSpaceId, sourceId, tenantId }) => {
      const source = await input.sources.get({ id: sourceId, knowledgeSpaceId });
      if (!source) {
        return null;
      }
      if (source.version !== expectedVersion) {
        throw new SourceVersionConflictError(sourceId, expectedVersion);
      }
      if (!source.credentialRef) {
        return source;
      }

      try {
        // This lifecycle transaction performs the source CAS and retires the old locator together.
        // Calling lifecycle.retire() directly would leave the source pointing at a retired secret.
        return await input.retiredSecrets.activateRotateAndRetire({
          expectedVersion,
          knowledgeSpaceId,
          metadata: redactSourceMetadata(source.metadata),
          newCredentialRef: null,
          sourceId,
          tenantId,
        });
      } catch (error) {
        const committed = await recoverCommittedRevoke({
          credentialRef: source.credentialRef,
          expectedVersion,
          knowledgeSpaceId,
          lifecycle: input.retiredSecrets,
          sourceId,
          sources: input.sources,
          tenantId,
        });
        if (committed) {
          return committed;
        }
        if (error instanceof SourceVersionConflictError) {
          throw error;
        }
        throw mutationFailure("Source credential revocation failed", error);
      }
    },
    rotate: async ({ credentials, expectedVersion, knowledgeSpaceId, sourceId, tenantId }) => {
      const source = await input.sources.get({ id: sourceId, knowledgeSpaceId });
      if (!source) {
        return null;
      }
      if (source.version !== expectedVersion) {
        throw new SourceVersionConflictError(sourceId, expectedVersion);
      }

      const credentialRef = generateCredentialRef();
      const operationId = generateOperationId();
      const reservation = await input.retiredSecrets.reserveStaged({
        credentialRef,
        knowledgeSpaceId,
        operationId,
        purpose: "rotate",
        recoverAfter: stagedRecoverAfter(now()),
        sourceId,
        tenantId,
      });
      assertReservationScope(reservation, {
        credentialRef,
        knowledgeSpaceId,
        operationId,
        purpose: "rotate",
        sourceId,
        tenantId,
      });
      if (reservation.state === "active") {
        const committed = await recoverCommittedActivation({
          credentialRef,
          expectedVersion,
          knowledgeSpaceId,
          lifecycle: input.retiredSecrets,
          operationId,
          purpose: "rotate",
          sourceId,
          sources: input.sources,
          tenantId,
        });
        if (committed) {
          return committed;
        }
        throw terminalReservationError();
      }
      if (reservation.state !== "staged") {
        throw terminalReservationError();
      }

      try {
        await input.retiredSecrets.withWriteAdmission({ knowledgeSpaceId, tenantId }, () =>
          putReservedSecret(input.secretStore, {
            credentialRef,
            credentials,
            knowledgeSpaceId,
            sourceId,
            tenantId,
          }),
        );
      } catch (error) {
        throw mutationFailure("Source credential persistence failed", error);
      }

      try {
        return await input.retiredSecrets.activateRotateAndRetire({
          expectedVersion,
          knowledgeSpaceId,
          metadata: redactSourceMetadata(source.metadata),
          newCredentialRef: credentialRef,
          operationId,
          sourceId,
          tenantId,
        });
      } catch (error) {
        const committed = await recoverCommittedActivation({
          credentialRef,
          expectedVersion,
          knowledgeSpaceId,
          lifecycle: input.retiredSecrets,
          operationId,
          purpose: "rotate",
          sourceId,
          sources: input.sources,
          tenantId,
        });
        if (committed) {
          return committed;
        }
        if (error instanceof SourceVersionConflictError) {
          throw error;
        }
        throw mutationFailure("Source credential activation failed", error);
      }
    },
  };
}

async function putReservedSecret(
  secretStore: SourceSecretStore,
  input: {
    readonly credentialRef: string;
    readonly credentials: Readonly<Record<string, unknown>>;
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  const expectedFingerprint = secretStore.fingerprint({
    credentials: input.credentials,
    knowledgeSpaceId: input.knowledgeSpaceId,
    sourceId: input.sourceId,
    tenantId: input.tenantId,
  });
  const stored = await secretStore.put({
    credentials: input.credentials,
    knowledgeSpaceId: input.knowledgeSpaceId,
    ref: input.credentialRef,
    sourceId: input.sourceId,
    tenantId: input.tenantId,
  });
  if (stored.ref !== input.credentialRef) {
    throw new Error("Source SecretStore returned a different reserved ref");
  }
  if (stored.fingerprint !== expectedFingerprint) {
    throw new Error("Source SecretStore returned a different credential fingerprint");
  }
}

async function recoverCommittedActivation(input: {
  readonly credentialRef: string;
  readonly expectedVersion?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly lifecycle: Pick<SourceSecretLifecycleRepository, "getByRef">;
  readonly operationId: string;
  readonly purpose: "create" | "rotate";
  readonly sourceId: string;
  readonly sources: Pick<SourceRepository, "get">;
  readonly tenantId: string;
}): Promise<Source | null> {
  const recovered = await safeReadActivation(input);
  if (!recovered) {
    return null;
  }
  const { lifecycleRef, source } = recovered;
  const expectedSourceVersion =
    input.expectedVersion === undefined ? source.version : input.expectedVersion + 1;
  return lifecycleRef.state === "active" &&
    lifecycleRef.operationId === input.operationId &&
    lifecycleRef.purpose === input.purpose &&
    lifecycleRef.tenantId === input.tenantId &&
    lifecycleRef.knowledgeSpaceId === input.knowledgeSpaceId &&
    lifecycleRef.sourceId === input.sourceId &&
    lifecycleRef.sourceVersion === source.version &&
    source.credentialRef === input.credentialRef &&
    source.version === expectedSourceVersion
    ? source
    : null;
}

async function recoverCommittedRevoke(input: {
  readonly credentialRef: string;
  readonly expectedVersion: number;
  readonly knowledgeSpaceId: string;
  readonly lifecycle: Pick<SourceSecretLifecycleRepository, "getByRef">;
  readonly sourceId: string;
  readonly sources: Pick<SourceRepository, "get">;
  readonly tenantId: string;
}): Promise<Source | null> {
  const recovered = await safeReadActivation(input);
  if (!recovered) {
    return null;
  }
  const { lifecycleRef, source } = recovered;
  return lifecycleRef.state === "retired" &&
    lifecycleRef.tenantId === input.tenantId &&
    lifecycleRef.knowledgeSpaceId === input.knowledgeSpaceId &&
    lifecycleRef.sourceId === input.sourceId &&
    !source.credentialRef &&
    source.version === input.expectedVersion + 1
    ? source
    : null;
}

async function safeReadActivation(input: {
  readonly credentialRef: string;
  readonly knowledgeSpaceId: string;
  readonly lifecycle: Pick<SourceSecretLifecycleRepository, "getByRef">;
  readonly sourceId: string;
  readonly sources: Pick<SourceRepository, "get">;
}): Promise<{ readonly lifecycleRef: SourceSecretLifecycleRef; readonly source: Source } | null> {
  try {
    const [source, lifecycleRef] = await Promise.all([
      input.sources.get({ id: input.sourceId, knowledgeSpaceId: input.knowledgeSpaceId }),
      input.lifecycle.getByRef({ credentialRef: input.credentialRef }),
    ]);
    return source && lifecycleRef ? { lifecycleRef, source } : null;
  } catch {
    // Recovery reads are best-effort and never replace the stable mutation error from activation.
    return null;
  }
}

function stagedRecoverAfter(timestamp: string): string {
  return new Date(Date.parse(timestamp) + stagedSecretRecoveryMs).toISOString();
}

function mutationFailure(message: string, cause: unknown): SourceCredentialMutationError {
  return new SourceCredentialMutationError(message, { cause });
}

function terminalReservationError(): SourceCredentialMutationError {
  return new SourceCredentialMutationError(
    "Source credential lifecycle operation is no longer writable",
  );
}

function assertReservationScope(
  reservation: SourceSecretLifecycleRef,
  expected: {
    readonly credentialRef: string;
    readonly knowledgeSpaceId: string;
    readonly operationId: string;
    readonly purpose: "create" | "rotate";
    readonly sourceId: string;
    readonly tenantId: string;
  },
): void {
  if (
    reservation.credentialRef !== expected.credentialRef ||
    reservation.knowledgeSpaceId !== expected.knowledgeSpaceId ||
    reservation.operationId !== expected.operationId ||
    reservation.purpose !== expected.purpose ||
    reservation.sourceId !== expected.sourceId ||
    reservation.tenantId !== expected.tenantId
  ) {
    throw new SourceCredentialMutationError("Source credential lifecycle reservation mismatch");
  }
}

function sourceCreateFields(
  input: CreateSourceWithCredentialsInput,
): Omit<CreateSourceInput, "credentialRef" | "id" | "metadata"> {
  return {
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    name: input.name,
    ...(input.permissionScope ? { permissionScope: input.permissionScope } : {}),
    ...(input.status ? { status: input.status } : {}),
    type: input.type,
    uri: input.uri,
  };
}

export function readLegacyCredentials(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  const credentials = metadata?.credentials;
  if (!isPlainRecord(credentials)) {
    return undefined;
  }
  return cloneRecord(credentials);
}

function cloneWithEphemeralCredentials(
  source: Source,
  credentials: Readonly<Record<string, unknown>>,
): Source {
  return {
    ...source,
    metadata: {
      ...redactSourceMetadata(source.metadata),
      credentials: cloneRecord(credentials),
    },
    permissionScope: [...source.permissionScope],
  };
}

function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sourceCredentialUpdate(input: UpdateSourceInput): UpdateSourceInput {
  return {
    ...input,
    ...(input.metadata ? { metadata: redactSourceMetadata(input.metadata) } : {}),
  };
}
