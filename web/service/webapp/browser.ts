import type { WebAppClientContext } from './index'
import { contract } from '@dify/contracts/api/web/orpc.gen'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The generated Web client preserves the existing public auth and access guard transport.
import { request } from '../base'
import { validateDefinedErrors } from '../console/defined-errors'
import { getWebAppPublicApiPath, getWebAppScopeKey, resolveWebAppAddress } from '../webapp-address'
import { getWebAppAccessToken, getWebAppAuthSessionSnapshot } from '../webapp-auth'

export const webAppBrowserLink = new OpenAPILink<WebAppClientContext>(contract, {
  url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
  fetch: async (input, init, options) => {
    // Capture scope per request; a shared client must never retain the previous App.
    const address = options.context.address ?? resolveWebAppAddress()
    if (!address) throw new DOMException('No active Web App.', 'AbortError')
    const scopeKey = getWebAppScopeKey(address)
    const sessionRevision = options.context.authSession ?? getWebAppAuthSessionSnapshot()
    const accessToken = getWebAppAccessToken()
    const assertCurrentApp = () => {
      const current = resolveWebAppAddress()
      if (
        !current ||
        getWebAppScopeKey(current) !== scopeKey ||
        getWebAppAuthSessionSnapshot() !== sessionRevision ||
        getWebAppAccessToken() !== accessToken
      )
        throw new DOMException('The active Web App changed.', 'AbortError')
    }

    assertCurrentApp()
    const baseURL = new URL(PUBLIC_API_PREFIX, window.location.origin)
    const url = new URL(input.url)
    const basePath = baseURL.pathname.replace(/\/$/, '')
    url.pathname = basePath + getWebAppPublicApiPath(address, url.pathname.slice(basePath.length))
    let scopedRequest = input
    if (url.href !== input.url) {
      // Passing input.body directly turns buffered JSON or files into streaming uploads.
      const body = input.body ? await input.blob() : undefined
      assertCurrentApp()
      scopedRequest = new Request(url, {
        body,
        method: input.method,
        headers: input.headers,
        signal: input.signal,
        credentials: input.credentials,
        mode: input.mode,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
      })
    }
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
