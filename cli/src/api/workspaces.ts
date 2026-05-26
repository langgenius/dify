import type { WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export class WorkspacesClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<WorkspaceListResponse> {
    return this.http.get('workspaces').json<WorkspaceListResponse>()
  }
}
