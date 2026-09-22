import type { AppDescribeResponse, AppListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { AppReader } from './app-reader'
import type { ListQuery } from './apps'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'
import { normalizeMode } from './apps'

export class PermittedExternalAppsClient implements AppReader {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  // workspaceId is ignored: the external grant is not workspace-scoped.
  async list(q: ListQuery): Promise<AppListResponse> {
    return this.orpc.permittedExternalApps.get({
      query: {
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        mode: normalizeMode(q.mode),
        name: q.name !== undefined && q.name !== '' ? q.name : undefined,
      },
    })
  }

  async describe(appId: string, fields?: readonly string[]): Promise<AppDescribeResponse> {
    return this.orpc.permittedExternalApps.byAppId.get({
      params: { app_id: appId },
      query: { fields: fields !== undefined && fields.length > 0 ? fields.join(',') : undefined },
    })
  }
}
