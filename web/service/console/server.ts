import type { ClientLink } from '@orpc/client'
import type { AnyContractRouter } from '@orpc/contract'
import type { ConsoleClientContext } from './index'
import { onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { cache } from 'react'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { SERVER_CONSOLE_API_PREFIX } from '@/config/server'
import { cookies, headers } from '@/next/headers'
import { createConsoleContractLink } from './contract-loader'
import { normalizeConsoleOpenAPIURL } from './openapi-url'
import 'server-only'

export const resolveServerConsoleApiPrefix = (
  serverConsoleApiPrefix = SERVER_CONSOLE_API_PREFIX,
  publicApiPrefix = API_PREFIX,
) => {
  if (serverConsoleApiPrefix) return serverConsoleApiPrefix
  try {
    return new URL(publicApiPrefix).href
  } catch {
    return null
  }
}

export const resolveServerConsoleApiUrl = (
  pathname: string,
  serverConsoleApiPrefix = SERVER_CONSOLE_API_PREFIX,
  publicApiPrefix = API_PREFIX,
) => {
  const apiPrefix = resolveServerConsoleApiPrefix(serverConsoleApiPrefix, publicApiPrefix)
  if (!apiPrefix) return null

  return new URL(pathname.replace(/^\//, ''), `${apiPrefix.replace(/\/$/, '')}/`).href
}

const getServerConsoleApiPrefix = () => {
  const apiPrefix = resolveServerConsoleApiPrefix()
  if (!apiPrefix) throw new Error('Server console API URL is not configured')

  return apiPrefix
}

const getConsoleRequestIdentity = cache(async () => {
  const requestHeaders = await headers()
  const cookieStore = await cookies()

  return {
    cookie: requestHeaders.get('cookie') || undefined,
    csrfToken: cookieStore.get(CSRF_COOKIE_NAME())?.value,
  }
})

export const getServerConsoleRequestHeaders = async () => {
  const { cookie, csrfToken } = await getConsoleRequestIdentity()
  const requestHeaders = new Headers({ Accept: 'application/json' })
  if (cookie) requestHeaders.set('cookie', cookie)
  if (csrfToken) requestHeaders.set(CSRF_HEADER_NAME, csrfToken)
  return requestHeaders
}

function createServerConsoleOpenAPILink(
  contract: AnyContractRouter,
): ClientLink<ConsoleClientContext> {
  return new OpenAPILink<ConsoleClientContext>(contract, {
    url: getServerConsoleApiPrefix,
    headers: getServerConsoleRequestHeaders,
    fetch: (request, init) => {
      if (request.body && !request.headers.has('content-type'))
        request.headers.set('Content-Type', 'application/json')

      const normalizedURL = normalizeConsoleOpenAPIURL(request.url)
      const normalizedRequest =
        normalizedURL === request.url ? request : new Request(normalizedURL, request)
      return globalThis.fetch(normalizedRequest, {
        ...init,
        cache: 'no-store',
      })
    },
    interceptors: [
      onError((error) => {
        console.error(error)
      }),
    ],
  })
}

const consoleServerLink = createConsoleContractLink<ConsoleClientContext>(
  createServerConsoleOpenAPILink,
)

// Share only the transport across RSC and Client Component SSR module graphs.
globalThis.$consoleServerLink = consoleServerLink
