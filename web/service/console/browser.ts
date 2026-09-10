import type { ClientLink } from '@orpc/client'
import type { AnyContractRouter } from '@orpc/contract'
import type { ConsoleClientContext } from './index'
import { onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The Console HTTP adapter must preserve existing auth refresh, CSRF, and error handling.
import { request } from '../base'
import { createConsoleContractLink } from './contract-loader'
import { normalizeConsoleOpenAPIURL } from './openapi-url'

function createBrowserLink(contract: AnyContractRouter): ClientLink<ConsoleClientContext> {
  return new OpenAPILink<ConsoleClientContext>(contract, {
    url: () => new URL(API_PREFIX, window.location.origin),
    fetch: (input, init, options) => {
      const requestInit = options.context.keepalive ? { ...init, keepalive: true } : init
      const normalizedURL = normalizeConsoleOpenAPIURL(input.url)
      const normalizedRequest =
        normalizedURL === input.url ? input : new Request(normalizedURL, input)
      return request(normalizedURL, requestInit, {
        fetchCompat: true,
        request: normalizedRequest,
        silent: options.context.silent,
      })
    },
    interceptors: [
      onError((error, { signal }) => {
        // Query teardown cancels in-flight requests; keep rejection semantics without an error overlay.
        if (signal?.aborted && error === signal.reason) return
        console.error(error)
      }),
    ],
  })
}

export const consoleBrowserLink = createConsoleContractLink(createBrowserLink)
