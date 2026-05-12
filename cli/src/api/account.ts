import type { KyInstance } from 'ky'
import type { AccountResponse } from '../types/data-contracts.js'

export class AccountClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async get(): Promise<AccountResponse> {
    return this.http.get('account').json<AccountResponse>()
  }
}
