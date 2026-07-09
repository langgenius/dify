import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient } from '@/http/orpc'

// Used by every /_version probe call site (the version command and the
// per-command auto-nudge). Both must construct their HTTP client with this
// timeout + retryAttempts: 0, otherwise the default 30s/3-retry budget kicks in.
// The oRPC client below inherits that http instance's policy, so the probe timeout still holds.
export const META_PROBE_TIMEOUT_MS = 2000

export class MetaClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http)
  }

  async serverVersion(): Promise<ServerVersionResponse> {
    return this.orpc.version.get()
  }
}
