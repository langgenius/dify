import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";

export type BulkOperationType = "document_upload" | "document_delete" | "document_reindex";

export type BulkOperationItemStatus = "queued" | "completed" | "failed" | "canceled" | "not_found";

export interface BulkOperationItem {
  readonly compilationJobId?: string | undefined;
  readonly documentId: string;
  readonly error?: string | undefined;
  /** Internal authorization binding captured before a destructive operation removes the asset. */
  readonly requiredPermissionScope?: readonly string[] | undefined;
  readonly status: BulkOperationItemStatus;
}

export interface BulkOperation {
  readonly capabilityGrantId?: string | undefined;
  readonly createdAt: string;
  readonly id: string;
  readonly items: readonly BulkOperationItem[];
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
  readonly type: BulkOperationType;
  readonly updatedAt: string;
}

export interface CreateBulkOperationInput {
  readonly capabilityGrantId?: string | undefined;
  readonly id: string;
  readonly items: readonly BulkOperationItem[];
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
  readonly type: BulkOperationType;
}

export interface BulkOperationLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

export interface BulkOperationCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface ListBulkOperationsInput {
  readonly candidateGrants: readonly string[];
  readonly cursor?: BulkOperationCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly requestedBySubjectId: string;
  readonly tenantId: string;
}

export interface BulkOperationRepository {
  create(input: CreateBulkOperationInput): Promise<BulkOperation>;
  findGroupedCompilationJobIds(
    input: Pick<
      ListBulkOperationsInput,
      "candidateGrants" | "knowledgeSpaceId" | "requestedBySubjectId" | "tenantId"
    > & {
      readonly compilationJobIds: readonly string[];
    },
  ): Promise<readonly string[]>;
  get(input: BulkOperationLookupInput): Promise<BulkOperation | null>;
  list(input: ListBulkOperationsInput): Promise<{
    readonly items: readonly BulkOperation[];
    readonly nextCursor?: BulkOperationCursor | undefined;
  }>;
}

export interface InMemoryBulkOperationRepositoryOptions {
  readonly maxItems: number;
  readonly maxOperations: number;
  readonly now?: () => string;
}

function cloneBulkOperation(operation: BulkOperation): BulkOperation {
  return JSON.parse(JSON.stringify(operation)) as BulkOperation;
}

export function createInMemoryBulkOperationRepository({
  maxItems,
  maxOperations,
  now = () => new Date().toISOString(),
}: InMemoryBulkOperationRepositoryOptions): BulkOperationRepository {
  if (!Number.isInteger(maxOperations) || maxOperations < 1) {
    throw new Error("Bulk operation repository maxOperations must be at least 1");
  }

  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error("Bulk operation repository maxItems must be at least 1");
  }

  const operations = new Map<string, BulkOperation>();

  return {
    create: async (input) => {
      if (input.items.length > maxItems) {
        throw new Error(`Bulk operation repository maxItems=${maxItems} exceeded`);
      }

      if (!operations.has(input.id) && operations.size >= maxOperations) {
        throw new Error(`Bulk operation repository maxOperations=${maxOperations} exceeded`);
      }

      const timestamp = now();
      const operation = cloneBulkOperation({
        ...(input.capabilityGrantId ? { capabilityGrantId: input.capabilityGrantId } : {}),
        createdAt: timestamp,
        id: input.id,
        items: input.items.map((item) => ({ ...item })),
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
        ...(input.requestedBySubjectId ? { requestedBySubjectId: input.requestedBySubjectId } : {}),
        tenantId: input.tenantId,
        type: input.type,
        updatedAt: timestamp,
      });
      operations.set(operation.id, operation);

      return cloneBulkOperation(operation);
    },
    findGroupedCompilationJobIds: async (input) => {
      if (input.compilationJobIds.length > 1_000) {
        throw new Error("Bulk operation grouped compilation lookup exceeds 1000 ids");
      }
      const requested = new Set(input.compilationJobIds);
      const grouped = new Set<string>();
      for (const operation of operations.values()) {
        if (
          operation.tenantId !== input.tenantId ||
          operation.knowledgeSpaceId !== input.knowledgeSpaceId ||
          !canReadBulkOperation(operation, input)
        ) {
          continue;
        }
        for (const item of operation.items) {
          if (item.compilationJobId && requested.has(item.compilationJobId)) {
            grouped.add(item.compilationJobId);
          }
        }
      }
      return [...grouped].sort();
    },
    get: async ({ id, tenantId }) => {
      const operation = operations.get(id);

      return operation && operation.tenantId === tenantId ? cloneBulkOperation(operation) : null;
    },
    list: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxOperations) {
        throw new Error(`Bulk operation list limit must be between 1 and ${maxOperations}`);
      }
      const matching = [...operations.values()]
        .filter(
          (operation) =>
            operation.tenantId === input.tenantId &&
            operation.knowledgeSpaceId === input.knowledgeSpaceId &&
            (!input.cursor || compareCursor(operation, input.cursor) < 0) &&
            canReadBulkOperation(operation, input),
        )
        .sort((left, right) => compareCursor(right, left))
        .slice(0, input.limit + 1);
      const items = matching.slice(0, input.limit).map(cloneBulkOperation);
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
  };
}

function compareCursor(
  left: Pick<BulkOperation, "createdAt" | "id">,
  right: Pick<BulkOperationCursor, "createdAt" | "id">,
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function canReadBulkOperation(
  operation: BulkOperation,
  input: Pick<ListBulkOperationsInput, "candidateGrants" | "requestedBySubjectId">,
): boolean {
  for (const item of operation.items) {
    if (item.status === "not_found") {
      if (operation.requestedBySubjectId !== input.requestedBySubjectId) return false;
      continue;
    }
    if (!candidatePermissionScopeAllows(item.requiredPermissionScope, input.candidateGrants)) {
      return false;
    }
  }
  return true;
}
