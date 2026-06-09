import type { SessionListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

export class AccountSessionsClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async list(q?: { page?: number, limit?: number }): Promise<SessionListResponse> {
    return this.orpc.account.sessions.get({ query: { page: q?.page, limit: q?.limit } })
  }

  async revoke(sessionId: string): Promise<void> {
    await this.orpc.account.sessions.bySessionId.delete({ params: { session_id: sessionId } })
  }

  async revokeSelf(): Promise<void> {
    await this.orpc.account.sessions.self.delete()
  }
}
