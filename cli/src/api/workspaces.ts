import type { WorkspaceDetailResponse, WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export class WorkspacesClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<WorkspaceListResponse> {
    return this.http.get('workspaces').json<WorkspaceListResponse>()
  }

  /**
   * Server-side workspace switch via OpenAPI POST
   * `/workspaces/{id}/switch` — the bearer-authed equivalent of the
   * console's POST `/workspaces/switch`. The server updates the caller's
   * `current` tenant_account_join row. Callers MUST refresh their local
   * `hosts.yml` only after this resolves — never fall back to a local
   * write if the request fails, or `hosts.yml` will drift from the
   * server's state.
   */
  async switch(workspaceId: string): Promise<WorkspaceDetailResponse> {
    return this.http
      .post(`workspaces/${encodeURIComponent(workspaceId)}/switch`)
      .json<WorkspaceDetailResponse>()
  }
}
