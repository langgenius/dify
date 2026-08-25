import type { ClientOptions, HttpClient } from '../../src/http/types.js'
import { createHttpClient } from '../../src/http/client.js'
import { openAPIBase } from '../../src/util/host.js'

type ClientOverrides = Omit<ClientOptions, 'baseURL'>

// Wraps createHttpClient + openAPIBase for tests so call sites read at a glance.
// Accepts a bare bearer string for the common case, or an options object for everything else.
export function testHttpClient(host: string, bearerOrOpts?: string | ClientOverrides): HttpClient {
  const opts: ClientOverrides =
    typeof bearerOrOpts === 'string' ? { bearer: bearerOrOpts } : (bearerOrOpts ?? {})
  return createHttpClient({ baseURL: openAPIBase(host), ...opts })
}
