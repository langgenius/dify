import type { KyInstance } from 'ky'
import type { WorkspaceListResponseType } from '../types/openapi-schemas.js'
import { WorkspaceListResponse } from '../types/openapi-schemas.js'

export class WorkspacesClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<WorkspaceListResponseType> {
    const raw = await this.http.get('workspaces').json()
    return WorkspaceListResponse.parse(raw)
  }
}
