import type { ObjectStorageAdapter } from "@knowledge/core";

import type {
  DeletionObjectWriteAdmission,
  DeletionObjectWriteScope,
} from "./deletion-object-write-admission";

export async function withDeletionObjectWriteAdmission<T>(
  admission: DeletionObjectWriteAdmission | undefined,
  scope: DeletionObjectWriteScope,
  write: () => Promise<T>,
): Promise<T> {
  return admission ? admission.withSpaceWriteAdmission(scope, write) : write();
}

/**
 * Preserves the complete object-storage contract while routing every external put through the
 * space row-lock admission. This is used by compilation pipelines whose internal PDF/multimodal
 * extractors receive an ObjectStorageAdapter rather than an individual write callback.
 */
export function createDeletionAdmittedObjectStorage({
  admission,
  objectStorage,
  scope,
}: {
  readonly admission: DeletionObjectWriteAdmission | undefined;
  readonly objectStorage: ObjectStorageAdapter;
  readonly scope: DeletionObjectWriteScope;
}): ObjectStorageAdapter {
  if (!admission) return objectStorage;
  return {
    ...(objectStorage.close ? { close: () => objectStorage.close?.() ?? Promise.resolve() } : {}),
    deleteObject: (key) => objectStorage.deleteObject(key),
    getObject: (key) => objectStorage.getObject(key),
    getObjectStream: (key) => objectStorage.getObjectStream(key),
    headObject: (key) => objectStorage.headObject(key),
    health: () => objectStorage.health(),
    kind: objectStorage.kind,
    listObjects: (input) => objectStorage.listObjects(input),
    putObject: (input) =>
      admission.withSpaceWriteAdmission(scope, () => objectStorage.putObject(input)),
  };
}
