import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

// Used by every /_version probe call site (the version command and the
// per-command auto-nudge). Both must construct their ky client with this
// timeout + retry=0, otherwise the default 30s/3-retry budget kicks in.
export const META_PROBE_TIMEOUT_MS = 2000

export class MetaClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async serverVersion(): Promise<ServerVersionResponse> {
    return this.http.get('_version').json<ServerVersionResponse>()
  }
}
