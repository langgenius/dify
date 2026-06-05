import type { SessionListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HttpClient } from '@/http/types'

export class AccountSessionsClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async list(q?: { page?: number, limit?: number }): Promise<SessionListResponse> {
    return this.http.get<SessionListResponse>('account/sessions', {
      searchParams: { page: q?.page, limit: q?.limit },
    })
  }

  async revoke(sessionId: string): Promise<void> {
    await this.http.delete(`account/sessions/${encodeURIComponent(sessionId)}`)
  }

  async revokeSelf(): Promise<void> {
    await this.http.delete('account/sessions/self')
  }
}
