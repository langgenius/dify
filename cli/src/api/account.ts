import type { AccountResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export class AccountClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async get(): Promise<AccountResponse> {
    return this.http.get('account').json<AccountResponse>()
  }
}
