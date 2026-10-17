import type { ClientLink } from '@orpc/client'
import type { RouterContract } from '@orpc/contract'
import type { ConsoleClientContext } from './index'
import { onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The Console HTTP adapter must preserve existing auth refresh, CSRF, and error handling.
import { request } from '../base'
import { createConsoleContractLink } from './contract-loader'
import { validateDefinedErrors } from './defined-errors'
import { toOpenAPILinkBase } from './openapi-url'

function createBrowserLink(contract: RouterContract): ClientLink<ConsoleClientContext> {
  const linkBase = () => toOpenAPILinkBase(new URL(API_PREFIX, window.location.origin))
  return new OpenAPILink<ConsoleClientContext>(contract, {
    origin: () => linkBase().origin,
    url: () => linkBase().url,
    fetch: (url, init, options) => {
      const requestInit = options.context.keepalive ? { ...init, keepalive: true } : init
      return request(url, requestInit, {
        fetchCompat: true,
        request: new Request(url, requestInit),
        silent: options.context.silent,
      })
    },
    interceptors: [validateDefinedErrors(contract), onError((error) => console.error(error))],
  })
}

export const consoleBrowserLink = createConsoleContractLink(createBrowserLink)
