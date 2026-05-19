import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

export const META_PROBE_TIMEOUT_MS = 2000

export class MetaClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async serverVersion(): Promise<ServerVersionResponse> {
    return this.http
      .get('_version', {
        timeout: META_PROBE_TIMEOUT_MS,
        retry: { limit: 0 },
      })
      .json<ServerVersionResponse>()
  }
}
