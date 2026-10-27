import type { WebAppClientContext } from './index'
import { contract } from '@dify/contracts/api/web/orpc.gen'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The generated Web client preserves the existing public auth and access guard transport.
import { request } from '../base'
import { validateDefinedErrors } from '../console/defined-errors'
import { getWebAppPublicApiPath, getWebAppScopeKey, resolveWebAppAddress } from '../webapp-address'

export const webAppBrowserLink = new OpenAPILink<WebAppClientContext>(contract, {
  url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
  fetch: async (input, init, options) => {
    // Capture scope per request; a shared client must never retain the previous App.
    const address = options.context.address ?? resolveWebAppAddress()
    if (!address) throw new DOMException('No active Web App.', 'AbortError')
    const scopeKey = getWebAppScopeKey(address)
    const assertCurrentApp = () => {
      const current = resolveWebAppAddress()
      if (!current || getWebAppScopeKey(current) !== scopeKey)
        throw new DOMException('The active Web App changed.', 'AbortError')
    }

    assertCurrentApp()
    const baseURL = new URL(PUBLIC_API_PREFIX, window.location.origin)
    const url = new URL(input.url)
    const basePath = baseURL.pathname.replace(/\/$/, '')
    url.pathname = basePath + getWebAppPublicApiPath(address, url.pathname.slice(basePath.length))
    const scopedRequest = new Request(url, input)
    // oxlint-disable-next-line typescript/no-deprecated -- Generated Web calls must retain public passport, auth recovery, and access guard handling.
    const response = await request<Response>(url.href, init, {
      isPublicAPI: true,
      fetchCompat: true,
      request: scopedRequest,
      silent: options.context.silent,
    })
    assertCurrentApp()
    return response
  },
  interceptors: [validateDefinedErrors(contract)],
})
