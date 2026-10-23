import type { HttpClient } from '@dify/openapi-content-mapper'
import type { ConsoleClientContext } from './index'
import { createClient } from '@dify/openapi-content-mapper'
import { API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The inference pilot shares console auth refresh, CSRF and error handling.
import { request } from '../base'

declare global {
  var $consoleInferenceTransport: ((context: ConsoleClientContext) => HttpClient) | undefined
}

/** Each call owns its context; concurrent requests never share credentials or callbacks. */
export function createConsoleInferenceTransport(context: ConsoleClientContext = {}): HttpClient {
  if (typeof window === 'undefined') {
    if (!globalThis.$consoleInferenceTransport)
      throw new Error(
        'Import @/service/console/server before using console inference on the server.',
      )
    return globalThis.$consoleInferenceTransport(context)
  }
  return createClient({
    baseUrl: new URL(API_PREFIX, window.location.origin).href,
    fetch: async (input, init) => {
      const url = String(input)
      const requestInit = context.keepalive ? { ...init, keepalive: true } : init
      // oxlint-disable-next-line typescript/no-deprecated -- Keep the existing console auth refresh, CSRF and HTTP error behavior.
      const response = await request<Response>(url, requestInit, {
        fetchCompat: true,
        request: new Request(url, requestInit),
        silent: context.silent,
      })
      context.onResponseHeaders?.(response.headers)
      return response
    },
  })
}
