import type { KyInstance } from 'ky'
import type { ServerVersionResponse } from '../types/data-contracts.js'

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
