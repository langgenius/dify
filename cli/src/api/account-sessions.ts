import type { KyInstance } from 'ky'
import type { SessionListResponseType } from '../types/openapi-schemas.js'
import { SessionListResponse } from '../types/openapi-schemas.js'

export class AccountSessionsClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(): Promise<SessionListResponseType> {
    const raw = await this.http.get('account/sessions').json()
    return SessionListResponse.parse(raw)
  }

  async revoke(sessionId: string): Promise<void> {
    await this.http.delete(`account/sessions/${encodeURIComponent(sessionId)}`)
  }

  async revokeSelf(): Promise<void> {
    await this.http.delete('account/sessions/self')
  }
}
