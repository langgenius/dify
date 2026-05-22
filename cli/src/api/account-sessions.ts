import type { SessionListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export class AccountSessionsClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(q?: { page?: number, limit?: number }): Promise<SessionListResponse> {
    const params = new URLSearchParams()
    if (q?.page !== undefined)
      params.set('page', String(q.page))
    if (q?.limit !== undefined)
      params.set('limit', String(q.limit))
    const hasParams = Array.from(params.keys()).length > 0
    const opts = hasParams ? { searchParams: params } : undefined
    return this.http.get('account/sessions', opts).json<SessionListResponse>()
  }

  async revoke(sessionId: string): Promise<void> {
    await this.http.delete(`account/sessions/${encodeURIComponent(sessionId)}`)
  }

  async revokeSelf(): Promise<void> {
    await this.http.delete('account/sessions/self')
  }
}
