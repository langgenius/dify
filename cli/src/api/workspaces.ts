import type { WorkspaceDetailResponse, WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

export class WorkspacesClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    // oRPC client over the same transport (UA+bearer / retry / timeout / error-map) — SPEC §4.4:
    // one transport, a contract facade. Both methods are standard unary JSON, so both go through
    // the generated contract.
    this.orpc = createOpenApiClient(http)
  }

  async list(): Promise<WorkspaceListResponse> {
    return this.orpc.workspaces.get()
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
    return this.orpc.workspaces.byWorkspaceId.switch.post({ params: { workspace_id: workspaceId } })
  }
}
