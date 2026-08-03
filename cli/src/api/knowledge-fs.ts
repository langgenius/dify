import type {
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsCatData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsCatResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsFindData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsFindResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsGrepData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsGrepResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsLsData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsLsResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsStatData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsStatResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsTreeData,
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsTreeResponse,
  PostWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsDiffData,
  PostWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsDiffResponse,
} from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

type CatQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsCatData['query']
type DiffPayload =
  PostWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsDiffData['body']
type FindQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsFindData['query']
type GrepQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsGrepData['query']
type ListQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsLsData['query']
type StatQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsStatData['query']
type TreeQuery =
  GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsTreeData['query']

export type KnowledgeFsConsistencyClass = NonNullable<ListQuery['consistency_class']>
export type KnowledgeFsResourceType = NonNullable<FindQuery['resource_type']>

export class KnowledgeFsClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async cat(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: CatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsCatResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.cat.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }

  async diff(
    workspaceId: string,
    knowledgeSpaceId: string,
    body: DiffPayload,
  ): Promise<PostWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsDiffResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.diff.post(
      {
        body,
        params: pathParams(workspaceId, knowledgeSpaceId),
      },
    )
  }

  async find(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: FindQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsFindResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.find.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }

  async grep(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: GrepQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsGrepResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.grep.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }

  async list(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: ListQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsLsResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.ls.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }

  async stat(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: StatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsStatResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.stat.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }

  async tree(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: TreeQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsTreeResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.knowledgeSpaces.byKnowledgeSpaceId.fs.tree.get(
      {
        params: pathParams(workspaceId, knowledgeSpaceId),
        query,
      },
    )
  }
}

function pathParams(workspaceId: string, knowledgeSpaceId: string) {
  return {
    knowledge_space_id: knowledgeSpaceId,
    workspace_id: workspaceId,
  }
}
