import { createDeletionLifecycleFenceGuard } from "./deletion-lifecycle-fence";
import type { DeletionObjectWriteAdmission } from "./deletion-object-write-admission";
import type {
  DurableDeletionAcceptedResponse,
  DurableDeletionJobResponse,
} from "./durable-deletion-response-schemas";
import type {
  DurableDeletionService,
  RequestDocumentDeletionCommand,
  RequestKnowledgeSpaceDeletionCommand,
  RequestLogicalDocumentDeletionCommand,
  RequestSourceDeletionCommand,
} from "./durable-deletion-service";
import { DurableDeletionServiceError } from "./durable-deletion-service";

const TEST_JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const TEST_TIMESTAMP = "2026-07-14T12:00:00.000Z";

/** Explicit no-active-deletion safety ports for handler-only gateway tests. */
export function createAllowingDurableDeletionSafetyOptions() {
  const deletionObjectWriteAdmission: DeletionObjectWriteAdmission = {
    withSpaceWriteAdmission: (_scope, write) => write(),
  };
  return {
    deletionLifecycleFence: createDeletionLifecycleFenceGuard({
      getActiveFence: async () => null,
    }),
    deletionObjectWriteAdmission,
  };
}

/** Minimal handler-facing durable service for HTTP contract tests. */
export function createAcceptingDurableDeletionService(
  overrides: Partial<DurableDeletionService> = {},
): DurableDeletionService {
  return {
    get: async () => null,
    requestBulkDocumentDeletion: async (input) => ({
      items: input.documents.map((document) => ({
        documentId: document.documentId,
        ...accepted(input.knowledgeSpaceId, document.documentId, "document", "cascade"),
      })),
      total: input.documents.length,
    }),
    requestDocumentDeletion: async (input) => documentAccepted(input),
    requestKnowledgeSpaceDeletion: async (input) => knowledgeSpaceAccepted(input),
    requestLogicalDocumentDeletion: async (input) => logicalDocumentAccepted(input),
    requestSourceDeletion: async (input) => sourceAccepted(input),
    retry: async () => null,
    ...overrides,
  };
}

export function createNotFoundDurableDeletionService(): DurableDeletionService {
  return createAcceptingDurableDeletionService({
    requestKnowledgeSpaceDeletion: async () => {
      throw new DurableDeletionServiceError(
        "DURABLE_DELETION_NOT_FOUND",
        "Deletion target not found",
      );
    },
  });
}

function knowledgeSpaceAccepted(
  input: RequestKnowledgeSpaceDeletionCommand,
): DurableDeletionAcceptedResponse {
  return accepted(input.knowledgeSpaceId, input.knowledgeSpaceId, "knowledge_space", "cascade");
}

function sourceAccepted(input: RequestSourceDeletionCommand): DurableDeletionAcceptedResponse {
  return accepted(input.knowledgeSpaceId, input.sourceId, "source", input.deleteMode);
}

function documentAccepted(input: RequestDocumentDeletionCommand): DurableDeletionAcceptedResponse {
  return accepted(input.knowledgeSpaceId, input.documentId, "document", "cascade");
}

function logicalDocumentAccepted(
  input: RequestLogicalDocumentDeletionCommand,
): DurableDeletionAcceptedResponse {
  return accepted(input.knowledgeSpaceId, input.documentId, "logical_document", "cascade");
}

function accepted(
  knowledgeSpaceId: string,
  targetId: string,
  targetType: DurableDeletionJobResponse["targetType"],
  mode: NonNullable<DurableDeletionJobResponse["mode"]>,
): DurableDeletionAcceptedResponse {
  return {
    job: {
      checkpoint: "requested",
      createdAt: TEST_TIMESTAMP,
      id: TEST_JOB_ID,
      knowledgeSpaceId,
      mode,
      runState: "dispatch_pending",
      targetId,
      targetType,
      updatedAt: TEST_TIMESTAMP,
    },
    statusUrl: `/deletion-jobs/${TEST_JOB_ID}`,
  };
}
