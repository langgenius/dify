import { createHash } from "node:crypto";

export const SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY = "knowledgeFsSourceWorkflow";

export interface SourceDocumentWorkflowOwnership {
  readonly contentHash: string;
  readonly itemKey: string;
  readonly runId: string;
}

export function createSourceWorkflowDocumentAssetId(
  ownership: SourceDocumentWorkflowOwnership,
): string {
  const digest = createHash("sha256")
    .update("knowledge-fs-source-workflow-v1\0", "utf8")
    .update(ownership.runId, "utf8")
    .update("\0", "utf8")
    .update(ownership.itemKey, "utf8")
    .update("\0", "utf8")
    .update(ownership.contentHash, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`;
}

export function sourceWorkflowOwnershipMatches(
  value: unknown,
  expected: SourceDocumentWorkflowOwnership,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  return (
    actual.runId === expected.runId &&
    actual.itemKey === expected.itemKey &&
    actual.contentHash === expected.contentHash
  );
}
