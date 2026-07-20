import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";
import type { SourceDocumentWorkflowOwnership } from "./source-document-workflow-ownership";
import type { SourceRemoteDeletionPolicy } from "./source-product-workflow";

export interface PublishSourceLogicalRevisionInput {
  readonly contentHash: string;
  readonly documentAssetId: string;
  readonly documentAssetVersion: number;
  readonly etag?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly materializationOwnership?: SourceDocumentWorkflowOwnership | undefined;
  readonly mimeType: string;
  readonly providerItemId: string;
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly providerKind: "website" | "online-document" | "online-drive";
  readonly remoteDeletionPolicy: SourceRemoteDeletionPolicy;
  readonly sizeBytes: number;
  readonly sourceId: string;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
  readonly title: string;
}

export interface SourceLogicalRevisionPublisher {
  /**
   * The I5 logical-document aggregate is the only revision truth. Implementations create a
   * candidate using sourceId + providerItemId and jointly CAS-publish compilation + logical
   * activation only after materialization is ready. They must leave the prior active revision and
   * publication untouched on failure.
   */
  publish(
    input: PublishSourceLogicalRevisionInput,
    execution?: SourceLogicalRevisionPublicationExecution | undefined,
  ): Promise<{
    readonly documentId: string;
    readonly kind: "activated" | "unchanged";
    readonly revision: number;
  }>;
  markRemoteMissing?(
    input: {
      readonly documentId: string;
      readonly knowledgeSpaceId: string;
      readonly now: string;
      readonly permissionSnapshot: KnowledgeSpaceDurablePermissionReference;
      readonly policy: SourceRemoteDeletionPolicy;
      readonly providerItemId: string;
      readonly requestedBySubjectId: string;
      readonly sourceId: string;
      readonly tenantId: string;
    },
    execution?: SourceLogicalRevisionPublicationExecution | undefined,
  ): Promise<void>;
}

export interface SourceLogicalRevisionPublicationExecution {
  readonly assertActive?: (() => Promise<void>) | undefined;
  readonly signal?: AbortSignal | undefined;
}
