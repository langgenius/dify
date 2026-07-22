import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";

export type BulkOperationType = "document_upload" | "document_delete" | "document_reindex";

export type BulkOperationItemStatus = "queued" | "completed" | "failed" | "not_found";

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

export interface BulkOperationRepository {
  create(input: CreateBulkOperationInput): Promise<BulkOperation>;
  get(input: BulkOperationLookupInput): Promise<BulkOperation | null>;
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
    get: async ({ id, tenantId }) => {
      const operation = operations.get(id);

      return operation && operation.tenantId === tenantId ? cloneBulkOperation(operation) : null;
    },
  };
}
