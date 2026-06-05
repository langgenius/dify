import type { SessionListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient, unwrap } from '@/http/orpc'

export class AccountSessionsClient {
  private readonly http: HttpClient
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.http = http
    this.orpc = createOpenApiClient(http, http.baseURL)
  }

  // Stays on the raw client until the backend declares page/limit query params on
  // GET /account/sessions — the generated contract models no query yet, so an oRPC call
  // would drop them. Migrated once the annotation lands (SPEC §7 stage 2 / plan Workstream C).
  async list(q?: { page?: number, limit?: number }): Promise<SessionListResponse> {
    return this.http.get<SessionListResponse>('account/sessions', {
      searchParams: { page: q?.page, limit: q?.limit },
    })
  }

  async revoke(sessionId: string): Promise<void> {
    await unwrap(this.orpc.account.sessions.bySessionId.delete({ params: { session_id: sessionId } }))
  }

  async revokeSelf(): Promise<void> {
    await unwrap(this.orpc.account.sessions.self.delete())
  }
}
