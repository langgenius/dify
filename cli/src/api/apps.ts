import type { AppDescribeResponse, AppListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient, unwrap } from '@/http/orpc'

export type ListQuery = {
  readonly workspaceId: string
  readonly page?: number
  readonly limit?: number
  readonly mode?: string
  readonly name?: string
  readonly tag?: string
}

export class AppsClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http, http.baseURL)
  }

  async list(q: ListQuery): Promise<AppListResponse> {
    return unwrap(this.orpc.apps.get({
      query: {
        workspace_id: q.workspaceId,
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        mode: q.mode !== undefined && q.mode !== '' ? q.mode : undefined,
        name: q.name !== undefined && q.name !== '' ? q.name : undefined,
        tag: q.tag !== undefined && q.tag !== '' ? q.tag : undefined,
      },
    }))
  }

  async describe(appId: string, workspaceId: string, fields?: readonly string[]): Promise<AppDescribeResponse> {
    return unwrap(this.orpc.apps.byAppId.describe.get({
      params: { app_id: appId },
      query: {
        workspace_id: workspaceId,
        // The backend parses a comma-separated string (validator splits on ','); the contract
        // types `fields` as a string accordingly, so join here rather than send an array.
        fields: fields !== undefined && fields.length > 0 ? fields.join(',') : undefined,
      },
    }))
  }
}
