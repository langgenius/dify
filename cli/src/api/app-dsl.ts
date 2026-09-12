import type {
  AppDslExportResponse,
  AppDslImportPayload,
  CheckDependenciesResult,
  Import,
} from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

export type ExportQuery = {
  readonly includeSecret?: boolean
  readonly includeWorkflowTools?: boolean
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

  async exportDsl(appId: string, query?: ExportQuery): Promise<AppDslExportResponse> {
    const resp = await this.orpc.apps.byAppId.dsl.get({
      params: { app_id: appId },
      query:
        query !== undefined
          ? {
              include_secret: query.includeSecret,
              include_workflow_tools: query.includeWorkflowTools,
              workflow_id: query.workflowId,
            }
          : undefined,
    })
    if (typeof resp.data !== 'string') throw new Error('export response missing data field')
    return resp
  }

  async checkDependencies(appId: string): Promise<CheckDependenciesResult> {
    return this.orpc.apps.byAppId.dependencies.check.get({
      params: { app_id: appId },
    })
  }
}
