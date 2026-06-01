import type { AccountResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HttpClient } from '@/http/types'

export class AccountClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async get(): Promise<AccountResponse> {
    return this.http.get<AccountResponse>('account')
  }
}
