import type { KyInstance } from 'ky'
import type { WorkspaceListResponse } from '../types/data-contracts.js'

export class WorkspacesClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<WorkspaceListResponse> {
    return this.http.get('workspaces').json<WorkspaceListResponse>()
  }
}
