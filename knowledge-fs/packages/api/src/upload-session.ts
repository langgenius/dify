import { isDeepStrictEqual } from "node:util";

import {
  type CompletedMultipartObjectPart,
  type ObjectStorageAdapter,
  type PresignedObjectUpload,
  UuidSchema,
} from "@knowledge/core";

import {
  StorageQuotaExceededError,
  type StorageQuotaRepository,
  type StorageUsageReader,
} from "./storage-quota";

export type UploadSessionMode = "multipart" | "single" | "small_fallback";
export type UploadSessionStatus =
  | "creating"
  | "ready"
  | "completing"
  | "completed"
  | "aborting"
  | "aborted"
  | "expired"
  | "failed";

export interface UploadSession {
  readonly abortedAt?: number | undefined;
  readonly checksumSha256Base64: string;
  readonly compilationJobId?: string | undefined;
  readonly completedAt?: number | undefined;
  readonly completionParts?: readonly CompletedMultipartObjectPart[] | undefined;
  /** Fresh task-scoped grant used for the resumable completion/publication phase. */
  readonly completionGrantId?: string | undefined;
  readonly contentType: string;
  readonly createdAt: number;
  readonly documentAssetId?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly expectedSizeBytes: number;
  readonly expiresAt: number;
  readonly fileName: string;
  readonly grantId: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly mode: UploadSessionMode;
  readonly multipartPartCount?: number | undefined;
  readonly multipartPartSizeBytes?: number | undefined;
  readonly multipartUploadId?: string | undefined;
  readonly objectKey: string;
  readonly reservedBytes: number;
  readonly rowVersion: number;
  readonly status: UploadSessionStatus;
  readonly tenantId: string;
  readonly updatedAt: number;
}

export interface CreateUploadSessionInput {
  readonly checksumSha256Base64: string;
  readonly contentType: string;
  readonly expectedSizeBytes: number;
  readonly fileName: string;
  readonly grantId: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface CreateUploadSessionResult {
  readonly session: UploadSession;
  readonly upload?: PresignedObjectUpload | undefined;
}

export interface CompleteUploadSessionInput {
  readonly grantId: string;
  readonly parts?: readonly CompletedMultipartObjectPart[] | undefined;
  readonly sessionId: string;
  readonly tenantId: string;
}

export interface CompleteUploadSessionResult {
  readonly session: UploadSession;
}

export interface UploadSessionRepository {
  claimExpired(input: {
    readonly limit: number;
    readonly now: number;
    readonly staleBefore: number;
  }): Promise<readonly UploadSession[]>;
  create(input: {
    readonly currentRawDocumentBytes: number;
    readonly maxRawDocumentBytes: number | null;
    readonly session: UploadSession;
  }): Promise<{ readonly created: boolean; readonly session: UploadSession }>;
  get(input: { readonly id: string; readonly tenantId: string }): Promise<UploadSession | null>;
  update(input: {
    readonly expectedRowVersion: number;
    readonly session: UploadSession;
  }): Promise<UploadSession | null>;
}

export interface UploadSessionCompletionPublisher {
  publish(input: {
    readonly checksumSha256Base64: string;
    readonly contentType: string;
    readonly expectedSizeBytes: number;
    readonly fileName: string;
    readonly grantId: string;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly objectKey: string;
    readonly tenantId: string;
    readonly uploadSessionId: string;
  }): Promise<{
    readonly compilationJobId: string;
    readonly documentAssetId: string;
  }>;
}

export type UploadSessionMetricStatus =
  | "aborted"
  | "checksum_failure"
  | "completed"
  | "created"
  | "expired";

export interface UploadSessionMetric {
  readonly bytes: number;
  readonly mode: UploadSessionMode;
  readonly status: UploadSessionMetricStatus;
}

export interface UploadSessionOperationalMetrics {
  /** Receives no tenant, resource, file, checksum, grant, object-key, or URL values. */
  record(event: UploadSessionMetric): Promise<void> | void;
}

export interface UploadSessionService {
  abort(input: { readonly sessionId: string; readonly tenantId: string }): Promise<UploadSession>;
  cleanupExpired(input: {
    readonly limit: number;
    readonly staleBefore: number;
  }): Promise<{ readonly expired: number; readonly failed: number }>;
  complete(input: CompleteUploadSessionInput): Promise<CompleteUploadSessionResult>;
  create(input: CreateUploadSessionInput): Promise<CreateUploadSessionResult>;
  get(input: {
    readonly sessionId: string;
    readonly tenantId: string;
  }): Promise<UploadSession | null>;
  presignPart(input: {
    readonly checksumSha256Base64: string;
    readonly contentLength: number;
    readonly partNumber: number;
    readonly sessionId: string;
    readonly tenantId: string;
  }): Promise<PresignedObjectUpload>;
  putSmallFile(input: {
    readonly body: Uint8Array;
    readonly sessionId: string;
    readonly tenantId: string;
  }): Promise<void>;
}

export interface CreateUploadSessionServiceOptions {
  readonly completionPublisher: UploadSessionCompletionPublisher;
  readonly generateId: () => string;
  readonly maxFileBytes: number;
  readonly multipartPartSizeBytes: number;
  readonly multipartThresholdBytes: number;
  readonly metrics?: UploadSessionOperationalMetrics | undefined;
  readonly now?: (() => number) | undefined;
  readonly objectStorage: ObjectStorageAdapter;
  readonly objectStorageUsage: StorageUsageReader;
  readonly presignTtlSeconds: number;
  readonly quotas: StorageQuotaRepository;
  readonly repository: UploadSessionRepository;
  readonly sessionTtlMs: number;
  readonly smallFileFallbackMaxBytes: number;
}

export class UploadSessionConflictError extends Error {
  constructor(message = "Upload session state conflict") {
    super(message);
    this.name = "UploadSessionConflictError";
  }
}

export class UploadSessionNotFoundError extends Error {
  constructor() {
    super("Upload session not found");
    this.name = "UploadSessionNotFoundError";
  }
}

export class UploadSessionIntegrityError extends Error {
  constructor() {
    super("Uploaded object does not match the reserved size and checksum");
    this.name = "UploadSessionIntegrityError";
  }
}

export class DirectUploadUnavailableError extends Error {
  constructor() {
    super("Direct object upload is unavailable for this file size");
    this.name = "DirectUploadUnavailableError";
  }
}

export function createInMemoryUploadSessionRepository({
  maxSessions,
}: {
  readonly maxSessions: number;
}): UploadSessionRepository {
  positiveSafeInteger(maxSessions, "repository maxSessions");
  const sessions = new Map<string, UploadSession>();
  const idempotency = new Map<string, string>();

  return {
    claimExpired: async ({ limit, now, staleBefore }) => {
      positiveSafeInteger(limit, "cleanup limit");
      const timestamp = validTimestamp(now);
      const stale = validTimestamp(staleBefore);
      if (stale > timestamp) {
        throw new Error("Upload session cleanup staleBefore must not exceed now");
      }
      const candidates = [...sessions.values()]
        .filter(
          (session) =>
            ((session.status === "creating" || session.status === "ready") &&
              session.expiresAt <= timestamp) ||
            (session.status === "aborting" && session.updatedAt <= stale),
        )
        .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id))
        .slice(0, limit);
      return candidates.map((session) => {
        const claimed: UploadSession = {
          ...session,
          rowVersion: session.rowVersion + 1,
          status: "aborting",
          updatedAt: timestamp,
        };
        sessions.set(claimed.id, claimed);
        return cloneUploadSession(claimed);
      });
    },
    create: async ({ currentRawDocumentBytes, maxRawDocumentBytes, session }) => {
      const idempotencyScope = uploadIdempotencyScope(session);
      const existingId = idempotency.get(idempotencyScope);
      if (existingId) {
        const existing = sessions.get(existingId);
        if (!existing) throw new Error("Upload session idempotency index is corrupt");
        assertCreateReplay(existing, session);
        return { created: false, session: cloneUploadSession(existing) };
      }
      if (sessions.has(session.id)) {
        throw new UploadSessionConflictError("Upload session id already exists");
      }
      if (sessions.size >= maxSessions) {
        throw new Error(`Upload session repository maxSessions=${maxSessions} exceeded`);
      }
      nonNegativeSafeInteger(currentRawDocumentBytes, "current raw document bytes");
      if (maxRawDocumentBytes !== null) {
        positiveSafeInteger(maxRawDocumentBytes, "maximum raw document bytes");
        const activeReservations = [...sessions.values()]
          .filter(
            (candidate) =>
              candidate.tenantId === session.tenantId &&
              candidate.knowledgeSpaceId === session.knowledgeSpaceId,
          )
          .reduce((total, candidate) => total + candidate.reservedBytes, 0);
        if (
          currentRawDocumentBytes >
          maxRawDocumentBytes - activeReservations - session.reservedBytes
        ) {
          throw new StorageQuotaExceededError();
        }
      }
      const stored = cloneUploadSession(session);
      sessions.set(stored.id, stored);
      idempotency.set(idempotencyScope, stored.id);
      return { created: true, session: cloneUploadSession(stored) };
    },
    get: async ({ id, tenantId }) => {
      const session = sessions.get(id);
      return session?.tenantId === tenantId ? cloneUploadSession(session) : null;
    },
    update: async ({ expectedRowVersion, session }) => {
      const current = sessions.get(session.id);
      if (
        !current ||
        current.tenantId !== session.tenantId ||
        current.rowVersion !== expectedRowVersion
      ) {
        return null;
      }
      if (session.rowVersion !== expectedRowVersion + 1) {
        throw new Error("Upload session update must increment rowVersion by one");
      }
      assertImmutableSessionFields(current, session);
      const stored = cloneUploadSession(session);
      sessions.set(stored.id, stored);
      return cloneUploadSession(stored);
    },
  };
}

export function createUploadSessionService({
  completionPublisher,
  generateId,
  maxFileBytes,
  multipartPartSizeBytes,
  multipartThresholdBytes,
  metrics,
  now = Date.now,
  objectStorage,
  objectStorageUsage,
  presignTtlSeconds,
  quotas,
  repository,
  sessionTtlMs,
  smallFileFallbackMaxBytes,
}: CreateUploadSessionServiceOptions): UploadSessionService {
  positiveSafeInteger(maxFileBytes, "maxFileBytes");
  positiveSafeInteger(multipartThresholdBytes, "multipartThresholdBytes");
  if (multipartThresholdBytes > maxFileBytes) {
    throw new Error("Upload session multipartThresholdBytes must not exceed maxFileBytes");
  }
  if (
    !Number.isSafeInteger(multipartPartSizeBytes) ||
    multipartPartSizeBytes < 5 * 1024 * 1024 ||
    multipartPartSizeBytes > 5 * 1024 * 1024 * 1024
  ) {
    throw new Error("Upload session multipartPartSizeBytes must be between 5 MiB and 5 GiB");
  }
  positiveSafeInteger(sessionTtlMs, "sessionTtlMs");
  if (
    !Number.isSafeInteger(presignTtlSeconds) ||
    presignTtlSeconds < 1 ||
    presignTtlSeconds > 900
  ) {
    throw new Error("Upload session presignTtlSeconds must be between 1 and 900");
  }
  nonNegativeSafeInteger(smallFileFallbackMaxBytes, "smallFileFallbackMaxBytes");
  if (smallFileFallbackMaxBytes >= multipartThresholdBytes) {
    throw new Error(
      "Upload session smallFileFallbackMaxBytes must be below multipartThresholdBytes",
    );
  }

  const requireSession = async (sessionId: string, tenantId: string): Promise<UploadSession> => {
    const id = UuidSchema.parse(sessionId);
    const tenant = requiredString(tenantId, "tenantId", 255);
    const session = await repository.get({ id, tenantId: tenant });
    if (!session) throw new UploadSessionNotFoundError();
    return session;
  };

  const save = async (
    current: UploadSession,
    changes: Partial<Omit<UploadSession, "id" | "rowVersion" | "tenantId">>,
  ): Promise<UploadSession> => {
    const timestamp = validTimestamp(now());
    const updated = await repository.update({
      expectedRowVersion: current.rowVersion,
      session: {
        ...current,
        ...changes,
        rowVersion: current.rowVersion + 1,
        updatedAt: timestamp,
      },
    });
    if (!updated) throw new UploadSessionConflictError();
    return updated;
  };

  return {
    abort: async ({ sessionId, tenantId }) => {
      const current = await requireSession(sessionId, tenantId);
      if (current.status === "aborted" || current.status === "expired") {
        return cloneUploadSession(current);
      }
      if (current.status === "completed") {
        throw new UploadSessionConflictError("Completed upload sessions cannot be aborted");
      }
      if (current.status === "aborting") {
        throw new UploadSessionConflictError("Upload session abort is already in progress");
      }
      if (current.status === "completing") {
        throw new UploadSessionConflictError("Completing upload sessions cannot be aborted");
      }
      const claimed = await save(current, { status: "aborting" });
      if (claimed.mode === "multipart" && claimed.multipartUploadId && objectStorage.directUpload) {
        await objectStorage.directUpload.abortMultipartUpload({
          key: claimed.objectKey,
          uploadId: claimed.multipartUploadId,
        });
      } else {
        await objectStorage.deleteObject(claimed.objectKey);
      }
      const aborted = await save(claimed, {
        abortedAt: validTimestamp(now()),
        reservedBytes: 0,
        status: "aborted",
      });
      safelyRecordUploadMetric(metrics, aborted, "aborted");
      return aborted;
    },
    cleanupExpired: async ({ limit, staleBefore }) => {
      positiveSafeInteger(limit, "cleanup limit");
      const timestamp = validTimestamp(now());
      const stale = validTimestamp(staleBefore);
      if (stale > timestamp) {
        throw new Error("Upload session cleanup staleBefore must not exceed now");
      }
      const claimed = await repository.claimExpired({ limit, now: timestamp, staleBefore: stale });
      let expired = 0;
      let failed = 0;
      for (const session of claimed) {
        try {
          if (
            session.mode === "multipart" &&
            session.multipartUploadId &&
            objectStorage.directUpload
          ) {
            await objectStorage.directUpload.abortMultipartUpload({
              key: session.objectKey,
              uploadId: session.multipartUploadId,
            });
          } else {
            await objectStorage.deleteObject(session.objectKey);
          }
          const expiredSession = await save(session, { reservedBytes: 0, status: "expired" });
          safelyRecordUploadMetric(metrics, expiredSession, "expired");
          expired += 1;
        } catch {
          // Leave the durable row in `aborting`; a later stale claim retries the idempotent remote
          // abort/delete instead of releasing quota before object cleanup is confirmed.
          failed += 1;
        }
      }
      return { expired, failed };
    },
    complete: async ({ grantId, parts: rawParts, sessionId, tenantId }) => {
      const current = await requireSession(sessionId, tenantId);
      const parts = normalizeCompletionParts(rawParts ?? []);
      if (current.status === "completed") {
        assertCompletionReplay(current, parts);
        return { session: cloneUploadSession(current) };
      }
      const completionGrantId = UuidSchema.parse(grantId);
      const recovering = current.status === "completing";
      if (recovering) {
        assertCompletionReplay(current, parts);
      } else {
        assertReadyAndUnexpired(current, now());
        validateCompletionParts(current, parts);
      }
      const claimed = await save(current, {
        completionGrantId,
        completionParts: parts,
        status: "completing",
      });
      try {
        let object = recovering ? await objectStorage.headObject(claimed.objectKey) : null;
        if (claimed.mode === "multipart") {
          const directUpload = objectStorage.directUpload;
          if (!directUpload || !claimed.multipartUploadId) {
            throw new DirectUploadUnavailableError();
          }
          if (!object) {
            try {
              await directUpload.completeMultipartUpload({
                key: claimed.objectKey,
                parts,
                uploadId: claimed.multipartUploadId,
              });
            } catch (error) {
              object = await objectStorage.headObject(claimed.objectKey);
              if (!object) throw error;
            }
          }
        }
        object ??= await objectStorage.headObject(claimed.objectKey);
        const checksumMatches =
          claimed.mode === "multipart"
            ? await objectStorage.directUpload?.verifyObjectSha256({
                checksumSha256Base64: claimed.checksumSha256Base64,
                expectedSizeBytes: claimed.expectedSizeBytes,
                key: claimed.objectKey,
              })
            : object?.checksumSha256Base64 === claimed.checksumSha256Base64;
        if (!object || object.sizeBytes !== claimed.expectedSizeBytes || checksumMatches !== true) {
          throw new UploadSessionIntegrityError();
        }
      } catch (error) {
        if (error instanceof UploadSessionIntegrityError) {
          await objectStorage.deleteObject(claimed.objectKey);
          const failed = await save(claimed, {
            errorCode: "UPLOAD_INTEGRITY_MISMATCH",
            reservedBytes: 0,
            status: "failed",
          });
          safelyRecordUploadMetric(metrics, failed, "checksum_failure");
        }
        throw error;
      }
      const publication = await completionPublisher.publish({
        checksumSha256Base64: claimed.checksumSha256Base64,
        contentType: claimed.contentType,
        expectedSizeBytes: claimed.expectedSizeBytes,
        fileName: claimed.fileName,
        grantId: completionGrantId,
        idempotencyKey: `upload-session:${claimed.id}:publish`,
        knowledgeSpaceId: claimed.knowledgeSpaceId,
        objectKey: claimed.objectKey,
        tenantId: claimed.tenantId,
        uploadSessionId: claimed.id,
      });
      try {
        const completed = await save(claimed, {
          compilationJobId: requiredString(publication.compilationJobId, "compilationJobId", 255),
          completedAt: validTimestamp(now()),
          documentAssetId: requiredString(publication.documentAssetId, "documentAssetId", 255),
          reservedBytes: 0,
          status: "completed",
        });
        safelyRecordUploadMetric(metrics, completed, "completed");
        return { session: completed };
      } catch (error) {
        if (error instanceof UploadSessionConflictError) {
          const latest = await requireSession(sessionId, tenantId);
          if (latest.status === "completed") {
            assertCompletionReplay(latest, parts);
            return { session: cloneUploadSession(latest) };
          }
        }
        throw error;
      }
    },
    create: async (rawInput) => {
      const input = normalizeCreateInput(rawInput, maxFileBytes);
      const directUpload = objectStorage.directUpload;
      const mode: UploadSessionMode = directUpload
        ? input.expectedSizeBytes >= multipartThresholdBytes
          ? "multipart"
          : "single"
        : input.expectedSizeBytes <= smallFileFallbackMaxBytes
          ? "small_fallback"
          : (() => {
              throw new DirectUploadUnavailableError();
            })();
      const id = UuidSchema.parse(generateId());
      const timestamp = validTimestamp(now());
      const multipartPartCount =
        mode === "multipart"
          ? Math.ceil(input.expectedSizeBytes / multipartPartSizeBytes)
          : undefined;
      if (multipartPartCount !== undefined && multipartPartCount > 10_000) {
        throw new Error("Upload session multipart plan exceeds 10000 parts");
      }
      const policy = await quotas.get({
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      const currentRawDocumentBytes =
        policy.maxRawDocumentBytes === null
          ? 0
          : (
              await objectStorageUsage.getStorageUsage({
                knowledgeSpaceId: input.knowledgeSpaceId,
              })
            ).rawDocumentBytes;
      const initial: UploadSession = {
        checksumSha256Base64: input.checksumSha256Base64,
        contentType: input.contentType,
        createdAt: timestamp,
        expectedSizeBytes: input.expectedSizeBytes,
        expiresAt: timestamp + sessionTtlMs,
        fileName: input.fileName,
        grantId: input.grantId,
        id,
        idempotencyKey: input.idempotencyKey,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mode,
        ...(multipartPartCount === undefined ? {} : { multipartPartCount }),
        ...(mode === "multipart" ? { multipartPartSizeBytes } : {}),
        objectKey: uploadObjectKey(input.tenantId, input.knowledgeSpaceId, id),
        reservedBytes: input.expectedSizeBytes,
        rowVersion: 1,
        status: "creating",
        tenantId: input.tenantId,
        updatedAt: timestamp,
      };
      const created = await repository.create({
        currentRawDocumentBytes,
        maxRawDocumentBytes: policy.maxRawDocumentBytes,
        session: initial,
      });
      if (created.created) safelyRecordUploadMetric(metrics, created.session, "created");
      let session = created.session;
      if (created.created) {
        try {
          if (session.mode === "multipart") {
            if (!directUpload) throw new DirectUploadUnavailableError();
            const multipart = await directUpload.createMultipartUpload({
              contentType: session.contentType,
              key: session.objectKey,
              metadata: uploadMetadata(session),
            });
            session = await save(session, {
              multipartUploadId: multipart.uploadId,
              status: "ready",
            });
          } else {
            session = await save(session, { status: "ready" });
          }
        } catch (error) {
          await save(session, {
            errorCode: "UPLOAD_INITIALIZATION_FAILED",
            reservedBytes: 0,
            status: "failed",
          });
          throw error;
        }
      }
      if (session.status !== "ready") {
        throw new UploadSessionConflictError("Upload session is not ready");
      }
      const upload =
        session.mode === "single" && directUpload
          ? await directUpload.presignPutObject({
              checksumSha256Base64: session.checksumSha256Base64,
              contentLength: session.expectedSizeBytes,
              contentType: session.contentType,
              expiresInSeconds: presignTtlSeconds,
              key: session.objectKey,
              metadata: uploadMetadata(session),
            })
          : undefined;
      return {
        session: cloneUploadSession(session),
        ...(upload ? { upload } : {}),
      };
    },
    get: async ({ sessionId, tenantId }) => {
      const session = await repository.get({
        id: UuidSchema.parse(sessionId),
        tenantId: requiredString(tenantId, "tenantId", 255),
      });
      return session ? cloneUploadSession(session) : null;
    },
    presignPart: async ({
      checksumSha256Base64,
      contentLength,
      partNumber,
      sessionId,
      tenantId,
    }) => {
      const session = await requireSession(sessionId, tenantId);
      assertReadyAndUnexpired(session, now());
      if (
        session.mode !== "multipart" ||
        !session.multipartUploadId ||
        !session.multipartPartCount ||
        !session.multipartPartSizeBytes
      ) {
        throw new UploadSessionConflictError("Upload session is not multipart");
      }
      if (
        !Number.isSafeInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > session.multipartPartCount
      ) {
        throw new UploadSessionConflictError("Upload session partNumber is outside the plan");
      }
      const plannedLength =
        partNumber === session.multipartPartCount
          ? session.expectedSizeBytes - session.multipartPartSizeBytes * (partNumber - 1)
          : session.multipartPartSizeBytes;
      if (contentLength !== plannedLength) {
        throw new UploadSessionConflictError(
          "Upload session part content length does not match the session plan",
        );
      }
      const directUpload = objectStorage.directUpload;
      if (!directUpload) throw new DirectUploadUnavailableError();
      return directUpload.presignMultipartPart({
        checksumSha256Base64: requiredString(checksumSha256Base64, "part checksum", 255),
        contentLength,
        expiresInSeconds: presignTtlSeconds,
        key: session.objectKey,
        partNumber,
        uploadId: session.multipartUploadId,
      });
    },
    putSmallFile: async ({ body, sessionId, tenantId }) => {
      const session = await requireSession(sessionId, tenantId);
      if (session.mode !== "small_fallback") {
        throw new UploadSessionConflictError("Upload session does not allow small-file fallback");
      }
      if (
        body.byteLength !== session.expectedSizeBytes ||
        body.byteLength > smallFileFallbackMaxBytes
      ) {
        throw new UploadSessionIntegrityError();
      }
      if ((await sha256Base64(body)) !== session.checksumSha256Base64) {
        throw new UploadSessionIntegrityError();
      }
      if (session.status === "completed" || session.status === "completing") return;
      assertReadyAndUnexpired(session, now());
      await objectStorage.putObject({
        body,
        checksumSha256Base64: session.checksumSha256Base64,
        contentType: session.contentType,
        key: session.objectKey,
        metadata: {
          ...uploadMetadata(session),
          checksum_sha256_base64: session.checksumSha256Base64,
        },
      });
    },
  };
}

function normalizeCreateInput(
  input: CreateUploadSessionInput,
  maxFileBytes: number,
): CreateUploadSessionInput {
  positiveSafeInteger(input.expectedSizeBytes, "expectedSizeBytes");
  if (input.expectedSizeBytes > maxFileBytes) {
    throw new Error(`Upload session exceeds maxFileBytes=${maxFileBytes}`);
  }
  return {
    checksumSha256Base64: requiredString(input.checksumSha256Base64, "checksum", 255),
    contentType: requiredString(input.contentType, "contentType", 255),
    expectedSizeBytes: input.expectedSizeBytes,
    fileName: requiredString(input.fileName, "fileName", 512),
    grantId: UuidSchema.parse(input.grantId),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey", 255),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: requiredString(input.tenantId, "tenantId", 255),
  };
}

function normalizeCompletionParts(
  parts: readonly CompletedMultipartObjectPart[],
): readonly CompletedMultipartObjectPart[] {
  return parts.map((part) => ({
    ...(part.checksumSha256Base64
      ? {
          checksumSha256Base64: requiredString(part.checksumSha256Base64, "part checksum", 255),
        }
      : {}),
    etag: requiredString(part.etag, "part etag", 255),
    partNumber: part.partNumber,
  }));
}

function validateCompletionParts(
  session: UploadSession,
  parts: readonly CompletedMultipartObjectPart[],
): void {
  if (session.mode !== "multipart") {
    if (parts.length > 0) {
      throw new UploadSessionConflictError("Single-part completion cannot include multipart parts");
    }
    return;
  }
  if (parts.length !== session.multipartPartCount) {
    throw new UploadSessionConflictError("Multipart completion does not match the session plan");
  }
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]?.partNumber !== index + 1) {
      throw new UploadSessionConflictError(
        "Multipart completion parts must be ordered and complete",
      );
    }
  }
}

function assertCompletionReplay(
  session: UploadSession,
  parts: readonly CompletedMultipartObjectPart[],
): void {
  if (!isDeepStrictEqual(session.completionParts ?? [], parts)) {
    throw new UploadSessionConflictError("Completed upload was replayed with different parts");
  }
}

function assertReadyAndUnexpired(session: UploadSession, timestamp: number): void {
  if (session.status !== "ready") {
    throw new UploadSessionConflictError(`Upload session is ${session.status}`);
  }
  if (session.expiresAt <= validTimestamp(timestamp)) {
    throw new UploadSessionConflictError("Upload session has expired");
  }
}

function uploadMetadata(session: UploadSession): Readonly<Record<string, string>> {
  return {
    knowledge_space_id: session.knowledgeSpaceId,
    tenant_id: session.tenantId,
    upload_session_id: session.id,
  };
}

function uploadObjectKey(tenantId: string, knowledgeSpaceId: string, sessionId: string): string {
  return `namespaces/${encodeURIComponent(tenantId)}/spaces/${encodeURIComponent(
    knowledgeSpaceId,
  )}/uploads/${encodeURIComponent(sessionId)}/source`;
}

function uploadIdempotencyScope(session: UploadSession): string {
  return `${session.tenantId}\0${session.knowledgeSpaceId}\0${session.idempotencyKey}`;
}

function assertCreateReplay(existing: UploadSession, requested: UploadSession): void {
  if (
    existing.tenantId !== requested.tenantId ||
    existing.knowledgeSpaceId !== requested.knowledgeSpaceId ||
    existing.grantId !== requested.grantId ||
    existing.fileName !== requested.fileName ||
    existing.contentType !== requested.contentType ||
    existing.expectedSizeBytes !== requested.expectedSizeBytes ||
    existing.checksumSha256Base64 !== requested.checksumSha256Base64 ||
    existing.mode !== requested.mode
  ) {
    throw new UploadSessionConflictError(
      "Upload idempotency key was reused with different request data",
    );
  }
}

function assertImmutableSessionFields(existing: UploadSession, updated: UploadSession): void {
  if (
    existing.id !== updated.id ||
    existing.tenantId !== updated.tenantId ||
    existing.knowledgeSpaceId !== updated.knowledgeSpaceId ||
    existing.grantId !== updated.grantId ||
    existing.idempotencyKey !== updated.idempotencyKey ||
    existing.objectKey !== updated.objectKey ||
    existing.mode !== updated.mode ||
    existing.expectedSizeBytes !== updated.expectedSizeBytes ||
    existing.checksumSha256Base64 !== updated.checksumSha256Base64 ||
    existing.createdAt !== updated.createdAt ||
    existing.expiresAt !== updated.expiresAt
  ) {
    throw new Error("Upload session immutable fields cannot be changed");
  }
}

function cloneUploadSession(session: UploadSession): UploadSession {
  return {
    ...session,
    ...(session.completionParts
      ? { completionParts: session.completionParts.map((part) => ({ ...part })) }
      : {}),
  };
}

function requiredString(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Upload session ${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function positiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Upload session ${field} must be a positive safe integer`);
  }
}

function nonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Upload session ${field} must be a non-negative safe integer`);
  }
}

function validTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Upload session clock must return a non-negative safe integer");
  }
  return value;
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buffer));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < digest.length; index += 3) {
    const first = digest[index] ?? 0;
    const second = digest[index + 1];
    const third = digest[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(block >>> 18) & 63];
    encoded += alphabet[(block >>> 12) & 63];
    encoded += second === undefined ? "=" : alphabet[(block >>> 6) & 63];
    encoded += third === undefined ? "=" : alphabet[block & 63];
  }
  return encoded;
}

function safelyRecordUploadMetric(
  metrics: UploadSessionOperationalMetrics | undefined,
  session: UploadSession,
  status: UploadSessionMetricStatus,
): void {
  try {
    const result = metrics?.record({
      bytes: session.expectedSizeBytes,
      mode: session.mode,
      status,
    });
    if (result) void result.catch(() => undefined);
  } catch {
    // Metrics are deliberately best-effort and cannot own durable upload transitions.
  }
}
