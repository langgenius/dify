import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HttpClient } from '@/http/types'

// Used by every /_version probe call site (the version command and the
// per-command auto-nudge). Both must construct their HTTP client with this
// timeout + retryAttempts: 0, otherwise the default 30s/3-retry budget kicks in.
export const META_PROBE_TIMEOUT_MS = 2000

export class MetaClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async serverVersion(): Promise<ServerVersionResponse> {
    return this.http.get<ServerVersionResponse>('_version')
  }
}
