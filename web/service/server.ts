import type { ClientLink } from '@orpc/client'
import type { AnyContractRouter, ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { consoleRouterContract } from '@/contract/router'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  API_PREFIX,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from '@/config'
import { SERVER_CONSOLE_API_PREFIX } from '@/config/server'
import { createConsoleDynamicLink } from './console-link'

import 'server-only'

export type ServerConsoleClientContext = {
  cookie?: string
  csrfToken?: string
}

const withTrailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`
const withoutLeadingSlash = (value: string) => value.startsWith('/') ? value.slice(1) : value

const resolveAbsoluteUrlPrefix = (value: string) => {
  try {
    return new URL(value).toString()
  }
  catch {
    return null
  }
}

export const resolveServerConsoleApiPrefix = (
  serverConsoleApiPrefix = SERVER_CONSOLE_API_PREFIX,
  publicApiPrefix = API_PREFIX,
) => serverConsoleApiPrefix || resolveAbsoluteUrlPrefix(publicApiPrefix)

export const resolveServerConsoleApiUrl = (
  pathname: string,
  serverConsoleApiPrefix = SERVER_CONSOLE_API_PREFIX,
  publicApiPrefix = API_PREFIX,
) => {
  const apiPrefix = resolveServerConsoleApiPrefix(serverConsoleApiPrefix, publicApiPrefix)
  if (!apiPrefix)
    return null

  return new URL(withoutLeadingSlash(pathname), withTrailingSlash(apiPrefix)).toString()
}

const getServerConsoleApiPrefix = () => {
  const apiPrefix = resolveServerConsoleApiPrefix()
  if (!apiPrefix)
    throw new Error('Server console API URL is not configured')

  return apiPrefix
}

const createServerConsoleRequestHeaders = (context: ServerConsoleClientContext | undefined) => {
  const requestHeaders = new Headers({
    Accept: 'application/json',
  })

  if (context?.cookie)
    requestHeaders.set('cookie', context.cookie)
  if (context?.csrfToken)
    requestHeaders.set(CSRF_HEADER_NAME, context.csrfToken)

  return requestHeaders
}

type ServerConsoleClientLink = ClientLink<ServerConsoleClientContext>

function createServerConsoleOpenAPILink(contract: AnyContractRouter): ServerConsoleClientLink {
  return new OpenAPILink<ServerConsoleClientContext>(contract, {
    url: getServerConsoleApiPrefix,
    headers: ({ context }) => createServerConsoleRequestHeaders(context),
    fetch: (request, init) => {
      if (request.body && !request.headers.has('content-type'))
        request.headers.set('Content-Type', 'application/json')

      return globalThis.fetch(request, {
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

export const getServerConsoleClientContext = async (): Promise<ServerConsoleClientContext> => {
  const { cookies, headers } = await import('@/next/headers')
  const requestHeaders = await headers()
  const cookieStore = await cookies()

  return {
    cookie: requestHeaders.get('cookie') || undefined,
    csrfToken: cookieStore.get(CSRF_COOKIE_NAME())?.value,
  }
}

export const getServerConsoleRequestHeaders = async () =>
  createServerConsoleRequestHeaders(await getServerConsoleClientContext())

const serverConsoleLink = createConsoleDynamicLink<ServerConsoleClientContext>(createServerConsoleOpenAPILink)

export const serverConsoleClient: JsonifiedClient<ContractRouterClient<typeof consoleRouterContract, ServerConsoleClientContext>> = createORPCClient(serverConsoleLink)

export const serverConsoleQuery = createTanstackQueryUtils(serverConsoleClient, {
  path: ['console'],
})
