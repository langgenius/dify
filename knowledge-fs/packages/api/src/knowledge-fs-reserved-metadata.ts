export const KNOWLEDGE_FS_RESERVED_METADATA_PREFIX = "__knowledgeFs" as const;

export function isKnowledgeFsReservedMetadataKey(key: string): boolean {
  return key.startsWith(KNOWLEDGE_FS_RESERVED_METADATA_PREFIX);
}

/** Caller-visible metadata never includes server-owned KnowledgeFS control records. */
export function omitKnowledgeFsReservedMetadata<T>(
  metadata: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !isKnowledgeFsReservedMetadataKey(key)),
  );
}
