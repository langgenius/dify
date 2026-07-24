import type { OpenAPILinkOptions } from '@orpc/openapi-client/fetch'
import type { APIRequestContext } from '@playwright/test'
import { Buffer } from 'node:buffer'

export type ConsoleClientContext = {
  timeoutMs?: number
}

type PlaywrightRequestContext = Pick<APIRequestContext, 'fetch'>
type OpenAPIFetch = NonNullable<OpenAPILinkOptions<ConsoleClientContext>['fetch']>

const defaultRequestTimeoutMs = 30_000
const bodylessResponseStatuses = new Set([204, 205, 304])

export function createPlaywrightFetch(requestContext: PlaywrightRequestContext): OpenAPIFetch {
  return async (request, _init, options, path) => {
    request.signal.throwIfAborted()

    const headers = Object.fromEntries(request.headers.entries())
    delete headers['content-length']

    const data = request.body ? Buffer.from(await request.arrayBuffer()) : undefined
    const apiResponse = await requestContext.fetch(request.url, {
      ...(data === undefined ? {} : { data }),
      failOnStatusCode: false,
      headers,
      maxRedirects: 0,
      method: request.method,
      timeout: options.context.timeoutMs ?? defaultRequestTimeoutMs,
    })

    try {
      const status = apiResponse.status()
      if (status >= 300 && status < 400) {
        const location = apiResponse.headers().location
        throw new Error(
          `Console API ${path.join('.')} redirected with ${status}${location ? ` to ${location}` : ''}.`,
        )
      }

      const responseHeaders = new Headers()
      for (const { name, value } of apiResponse.headersArray()) responseHeaders.append(name, value)
      responseHeaders.delete('content-encoding')
      responseHeaders.delete('content-length')
      responseHeaders.delete('transfer-encoding')

      const body =
        request.method === 'HEAD' || bodylessResponseStatuses.has(status)
          ? null
          : Uint8Array.from(await apiResponse.body())

      return new Response(body, {
        headers: responseHeaders,
        status,
        statusText: apiResponse.statusText(),
      })
    } finally {
      await apiResponse.dispose()
    }
  }
}
