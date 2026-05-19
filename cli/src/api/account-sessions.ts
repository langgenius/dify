import type { SessionListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export class AccountSessionsClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<SessionListResponse> {
    return this.http.get('account/sessions').json<SessionListResponse>()
  }

  async revoke(sessionId: string): Promise<void> {
    await this.http.delete(`account/sessions/${encodeURIComponent(sessionId)}`)
  }

  async revokeSelf(): Promise<void> {
    await this.http.delete('account/sessions/self')
  }
}
