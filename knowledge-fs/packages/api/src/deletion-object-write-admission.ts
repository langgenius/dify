export interface DeletionObjectWriteScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

/**
 * Serializes external object writes with durable deletion admission. Implementations must keep the
 * admission lock alive until `write` settles; a point-in-time preflight check is insufficient.
 */
export interface DeletionObjectWriteAdmission {
  withSpaceWriteAdmission<T>(scope: DeletionObjectWriteScope, write: () => Promise<T>): Promise<T>;
}

export class DeletionObjectWriteAdmissionError extends Error {
  readonly code = "DELETION_OBJECT_WRITE_BLOCKED";

  constructor() {
    super("Object write is unavailable while durable deletion is active");
    this.name = "DeletionObjectWriteAdmissionError";
  }
}
