import type { AppDescribeResponse, AppListResponse, AppMode } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

export type ListQuery = {
  readonly workspaceId: string
  readonly page?: number
  readonly limit?: number
  readonly mode?: AppMode | ''
  readonly name?: string
  readonly tag?: string
}

export class AppsClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async list(q: ListQuery): Promise<AppListResponse> {
    return this.orpc.apps.get({
      query: {
        workspace_id: q.workspaceId,
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        mode: q.mode !== undefined && q.mode !== '' ? q.mode : undefined,
        name: q.name !== undefined && q.name !== '' ? q.name : undefined,
        tag: q.tag !== undefined && q.tag !== '' ? q.tag : undefined,
      },
    })
  }

  async describe(appId: string, fields?: readonly string[]): Promise<AppDescribeResponse> {
    return this.orpc.apps.byAppId.describe.get({
      params: { app_id: appId },
      query: {
        fields: fields !== undefined && fields.length > 0 ? fields.join(',') : undefined,
      },
    })
  }
}
