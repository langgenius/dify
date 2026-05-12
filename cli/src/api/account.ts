import type { KyInstance } from 'ky'
import type { AccountResponseType } from '../types/openapi-schemas.js'
import { AccountResponse } from '../types/openapi-schemas.js'

export class AccountClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async get(): Promise<AccountResponseType> {
    const raw = await this.http.get('account').json()
    return AccountResponse.parse(raw)
  }
}
