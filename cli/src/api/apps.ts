import type { AppDescribeResponse, AppListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HttpClient } from '@/http/types'

export type ListQuery = {
  readonly workspaceId: string
  readonly page?: number
  readonly limit?: number
  readonly mode?: string
  readonly name?: string
  readonly tag?: string
}

export class AppsClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async list(q: ListQuery): Promise<AppListResponse> {
    return this.http.get<AppListResponse>('apps', {
      searchParams: {
        workspace_id: q.workspaceId,
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        mode: q.mode !== undefined && q.mode !== '' ? q.mode : undefined,
        name: q.name !== undefined && q.name !== '' ? q.name : undefined,
        tag: q.tag !== undefined && q.tag !== '' ? q.tag : undefined,
      },
    })
  }

  async describe(appId: string, workspaceId: string, fields?: readonly string[]): Promise<AppDescribeResponse> {
    return this.http.get<AppDescribeResponse>(`apps/${encodeURIComponent(appId)}/describe`, {
      searchParams: {
        workspace_id: workspaceId,
        fields: fields !== undefined && fields.length > 0 ? fields.join(',') : undefined,
      },
    })
  }
}
