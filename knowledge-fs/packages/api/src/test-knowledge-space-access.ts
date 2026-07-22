import {
  type KnowledgeSpaceAccessService,
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";

export interface InitializedTestKnowledgeSpaceAccessScope {
  readonly knowledgeSpaceId: string;
  readonly ownerSubjectId?: string | undefined;
  readonly tenantId?: string | undefined;
}

/**
 * Test fixture helper that creates the same explicit owner aggregate required in production. It is
 * intentionally not an authorization bypass: omitted spaces remain inaccessible and fail closed.
 */
export async function createInitializedTestKnowledgeSpaceAccess(
  scopes: readonly InitializedTestKnowledgeSpaceAccessScope[],
): Promise<KnowledgeSpaceAccessService> {
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 100,
      maxListLimit: 100,
      maxMembersPerSpace: 100,
    }),
  });
  for (const scope of scopes) {
    await access.initialize({
      knowledgeSpaceId: scope.knowledgeSpaceId,
      ownerSubjectId: scope.ownerSubjectId ?? "user-1",
      tenantId: scope.tenantId ?? "tenant-1",
    });
  }
  return access;
}
