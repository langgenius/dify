import type { WebAppClientContext } from './index'
import { contract } from '@dify/contracts/api/web/orpc.gen'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
import { basePath as appBasePath } from '@/utils/var'
// oxlint-disable-next-line no-restricted-imports -- The generated Web client preserves the existing public auth and access guard transport.
import { request } from '../base'
import { validateDefinedErrors } from '../console/defined-errors'
import { isUnauthorizedError } from '../http-error'
import { getWebAppPublicApiPath, getWebAppScopeKey, resolveWebAppAddress } from '../webapp-address'
import { getWebAppAccessToken, getWebAppAuthSessionSnapshot } from '../webapp-auth'

function parseAccountSignin(raw: string | null) {
  if (!raw) return null
  try {
    const url = new URL(raw, window.location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

export const webAppBrowserLink = new OpenAPILink<WebAppClientContext>(contract, {
  url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
  fetch: async (input, init, options) => {
    const baseURL = new URL(PUBLIC_API_PREFIX, window.location.origin)
    const url = new URL(input.url)
    const basePath = baseURL.pathname.replace(/\/$/, '')
    const path = url.pathname.slice(basePath.length)
    if (path === '/system-features') {
      // oxlint-disable-next-line typescript/no-deprecated -- Public bootstrap must use the existing transport without requiring an App Code or Passport.
      return request<Response>(url.href, init, {
        isPublicAPI: true,
        isWebAppAccountAPI: true,
        fetchCompat: true,
        request: input,
        silent: options.context.silent,
      })
    }
    if (
      path.startsWith('/me/') ||
      path.startsWith('/account/') ||
      path === '/logout' ||
      path.startsWith('/migration/')
    ) {
      const sessionRevision = options.context.authSession ?? getWebAppAuthSessionSnapshot()
      const assertCurrentAccount = () => {
        if (sessionRevision !== getWebAppAuthSessionSnapshot())
          throw new DOMException('The Web App account changed.', 'AbortError')
      }
      assertCurrentAccount()
      // oxlint-disable-next-line typescript/no-deprecated -- The generated account client uses the existing Cookie, HTTP error, and account-session transport.
      const response = await request<Response>(url.href, init, {
        isPublicAPI: true,
        isWebAppAccountAPI: true,
        fetchCompat: true,
        request: input,
        silent: options.context.silent,
      }).catch(async (error: unknown) => {
        assertCurrentAccount()
        if (
          isUnauthorizedError(error) &&
          window.location.pathname.replace(/\/$/, '') === `${appBasePath}/my-apps`
        ) {
          const returnLocation = window.location.href
          const { webAppClient } = await import('./index')
          const features = await webAppClient.systemFeatures
            .get(undefined, {
              context: { silent: true },
            })
            .catch(() => {
              assertCurrentAccount()
              throw error
            })
          assertCurrentAccount()
          if (window.location.href !== returnLocation)
            throw new DOMException('The personal portal page changed.', 'AbortError')
          const signin = parseAccountSignin(features.account_login_url)
          if (signin) {
            const consolePrefix = signin.pathname.slice(0, -'/signin'.length)
            signin.searchParams.set('is_end_user', '1')
            signin.searchParams.set(
              'redirect_url',
              `${consolePrefix}/my-apps${window.location.search}${window.location.hash}`,
            )
            window.location.replace(signin.href)
          }
        }
        throw error
      })
      assertCurrentAccount()
      return response
    }
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
    url.pathname = basePath + getWebAppPublicApiPath(address, path)
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
