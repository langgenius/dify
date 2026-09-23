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
import type { HttpClient } from '@/http/types'
import { callCatalogOperation } from '@/http/catalog'

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
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async cat(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: CatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsCatResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.cat', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }

  async diff(
    workspaceId: string,
    knowledgeSpaceId: string,
    body: DiffPayload,
  ): Promise<PostWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsDiffResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.diff', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...body,
    })
  }

  async find(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: FindQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsFindResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.find', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }

  async grep(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: GrepQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsGrepResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.grep', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }

  async list(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: ListQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsLsResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.ls', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }

  async stat(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: StatQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsStatResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.stat', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }

  async tree(
    workspaceId: string,
    knowledgeSpaceId: string,
    query: TreeQuery,
  ): Promise<GetWorkspacesByWorkspaceIdKnowledgeFsKnowledgeSpacesByKnowledgeSpaceIdFsTreeResponse> {
    return callCatalogOperation(this.http, 'knowledge_fs.tree', {
      ...pathParams(workspaceId, knowledgeSpaceId),
      ...query,
    })
  }
}

function pathParams(workspaceId: string, knowledgeSpaceId: string) {
  return {
    knowledge_space_id: knowledgeSpaceId,
    workspace_id: workspaceId,
  }
}
