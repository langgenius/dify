import type { AccountResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient, unwrap } from '@/http/orpc'

export class AccountClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async get(): Promise<AccountResponse> {
    return unwrap(this.orpc.account.get())
  }
}
