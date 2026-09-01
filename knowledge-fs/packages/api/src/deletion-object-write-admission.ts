export interface DeletionObjectWriteScope {
  /** Identifies the concrete object being written when it already has an asset identity. */
  readonly documentAssetId?: string | undefined;
  /** Identifies the logical-document aggregate for revision and replacement writes. */
  readonly documentId?: string | undefined;
  readonly knowledgeSpaceId: string;
  /** Limits active Source-deletion fences to the Source that owns the external object. */
  readonly sourceId?: string | undefined;
  readonly tenantId: string;
}

/**
 * Serializes external object writes with durable deletion admission. Implementations must keep the
 * admission lock alive until `write` settles; a point-in-time preflight check is insufficient.
 */
export interface DeletionObjectWriteAdmission {
  /**
   * The historical method name is retained for compatibility; implementations fence the supplied
   * target hierarchy rather than every write in the knowledge space.
   */
  withSpaceWriteAdmission<T>(scope: DeletionObjectWriteScope, write: () => Promise<T>): Promise<T>;
}

export class DeletionObjectWriteAdmissionError extends Error {
  readonly code = "DELETION_OBJECT_WRITE_BLOCKED";

  constructor() {
    super("Object write is unavailable while durable deletion is active");
    this.name = "DeletionObjectWriteAdmissionError";
  }
}
