import type {
  AppDslImportPayload,
  CheckDependenciesResult,
  Import,
} from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

export type ExportQuery = {
  readonly includeSecret?: boolean
  readonly workflowId?: string
}

export class AppDslClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async importApp(workspaceId: string, payload: AppDslImportPayload): Promise<Import> {
    return this.orpc.workspaces.byWorkspaceId.apps.imports.post({
      params: { workspace_id: workspaceId },
      body: payload,
    })
  }

  async confirmImport(workspaceId: string, importId: string): Promise<Import> {
    return this.orpc.workspaces.byWorkspaceId.apps.imports.byImportId.confirm.post({
      params: { workspace_id: workspaceId, import_id: importId },
    })
  }

  async exportDsl(appId: string, query?: ExportQuery): Promise<string> {
    const resp = await this.orpc.apps.byAppId.export.get({
      params: { app_id: appId },
      query: query !== undefined
        ? {
            include_secret: query.includeSecret,
            workflow_id: query.workflowId,
          }
        : undefined,
    })
    // The response schema is an open object {"data": "<yaml string>"}; the
    // contract generator marks it as loose because the backend annotation
    // does not narrow the shape. Extract `data` directly.
    const data = (resp as Record<string, unknown>).data
    if (typeof data !== 'string')
      throw new Error('export response missing data field')
    return data
  }

  async checkDependencies(appId: string): Promise<CheckDependenciesResult> {
    return this.orpc.apps.byAppId.checkDependencies.get({
      params: { app_id: appId },
    })
  }
}
