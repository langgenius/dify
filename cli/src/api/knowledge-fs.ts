import type {
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsCatData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsCatResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsDiffData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsDiffResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsFindData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsFindResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsGrepData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsGrepResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsLsData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsLsResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsStatData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsStatResponse,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsTreeData,
  GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsTreeResponse,
} from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

type CatQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsCatData['query']
type DiffQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsDiffData['query']
type FindQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsFindData['query']
type GrepQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsGrepData['query']
type ListQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsLsData['query']
type StatQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsStatData['query']
type TreeQuery = GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsTreeData['query']

export type KnowledgeFsConsistencyClass = NonNullable<ListQuery['consistency_class']>
export type KnowledgeFsResourceType = NonNullable<FindQuery['resource_type']>

export class KnowledgeFsClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async cat(
    workspaceId: string,
    controlSpaceId: string,
    query: CatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsCatResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.cat.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async diff(
    workspaceId: string,
    controlSpaceId: string,
    query: DiffQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsDiffResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.diff.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async find(
    workspaceId: string,
    controlSpaceId: string,
    query: FindQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsFindResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.find.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async grep(
    workspaceId: string,
    controlSpaceId: string,
    query: GrepQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsGrepResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.grep.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async list(
    workspaceId: string,
    controlSpaceId: string,
    query: ListQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsLsResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.ls.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async stat(
    workspaceId: string,
    controlSpaceId: string,
    query: StatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsStatResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.stat.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }

  async tree(
    workspaceId: string,
    controlSpaceId: string,
    query: TreeQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsSpacesByControlSpaceIdFsTreeResponse> {
    return this.orpc.workspaces.byWorkspaceId.knowledgeFs.spaces.byControlSpaceId.fs.tree.get({
      params: pathParams(workspaceId, controlSpaceId),
      query,
    })
  }
}

function pathParams(workspaceId: string, controlSpaceId: string) {
  return {
    control_space_id: controlSpaceId,
    workspace_id: workspaceId,
  }
}
