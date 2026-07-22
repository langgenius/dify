import type {
  ProjectionSetPublication,
  ProjectionSetPublicationRepository,
} from "./projection-publication-repository";

export interface ProjectionPublicationWorkflow {
  rollback(
    input: RollbackPublishedProjectionSetInput,
  ): Promise<RollbackPublishedProjectionSetResult>;
}

export interface ProjectionPublicationWorkflowOptions {
  readonly publications: ProjectionSetPublicationRepository;
}

export interface RollbackPublishedProjectionSetInput {
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface RollbackPublishedProjectionSetResult {
  readonly previousPublishedFingerprint?: string | undefined;
  readonly restored: ProjectionSetPublication;
  readonly superseded?: ProjectionSetPublication | undefined;
}

export function createProjectionPublicationWorkflow({
  publications,
}: ProjectionPublicationWorkflowOptions): ProjectionPublicationWorkflow {
  return {
    rollback: async (input) => {
      const previousPublished = await publications.getPublished({
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      const rollback = await publications.rollback({
        ...input,
        expectedHeadRevision: previousPublished?.headRevision ?? 0,
      });

      return {
        ...(previousPublished
          ? { previousPublishedFingerprint: previousPublished.fingerprint }
          : {}),
        restored: rollback.published,
        ...(rollback.superseded ? { superseded: rollback.superseded } : {}),
      };
    },
  };
}
