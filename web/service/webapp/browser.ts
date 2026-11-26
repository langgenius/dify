import type { WebAppClientContext } from './index'
import { contract } from '@dify/contracts/api/web/orpc.gen'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
// oxlint-disable-next-line no-restricted-imports -- The generated Web client preserves the existing public auth and access guard transport.
import { request } from '../base'
import { validateDefinedErrors } from '../console/defined-errors'
import { isUnauthorizedError } from '../http-error'
import {
  getWebAppScopeKey,
  removeWebAppBasePath,
  resolveWebAppAddress,
  WEBAPP_PORTAL_LOGIN_CODE,
} from '../webapp-address'
import { getWebAppAccessToken, getWebAppAuthSessionSnapshot } from '../webapp-auth'
import {
  getWebAppApiBaseURL,
  getWebAppApiRoute,
  scopeWebAppRequestURL,
  withWebAppRequestURL,
} from '../webapp-request'

export const webAppBrowserLink = new OpenAPILink<WebAppClientContext>(contract, {
  url: getWebAppApiBaseURL,
  fetch: async (input, init, options) => {
    const route = getWebAppApiRoute(input.url)
    const { url, path } = route
    if (path === '/system-features') {
      // oxlint-disable-next-line typescript/no-deprecated -- Public bootstrap must use the existing transport without requiring an App Code or Passport.
      return request<Response>(url.href, init, {
        isPublicAPI: true,
        isWebAppAccountAPI: true,
        fetchCompat: true,
        request: input,
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
      }).catch(async (error: unknown) => {
        assertCurrentAccount()
        const { pathname, search, hash } = window.location
        const route = removeWebAppBasePath(pathname).replace(/\/$/, '')
        const isMyApps = route === '/my-apps'
        const isMyAccountProfile =
          route === '/my-account' && path === '/account/profile' && input.method === 'GET'
        if (
          isUnauthorizedError(error) &&
          (isMyApps || isMyAccountProfile) &&
          path !== '/logout' &&
          path !== '/account/session' &&
          !new URLSearchParams(search).has(WEBAPP_PORTAL_LOGIN_CODE)
        ) {
          const returnLocation = window.location.href
          const { redirectToWebAppPortalSignIn } = await import('./portal-login')
          assertCurrentAccount()
          if (window.location.href !== returnLocation)
            throw new DOMException('The personal portal page changed.', 'AbortError')
          try {
            await redirectToWebAppPortalSignIn(isMyApps ? `/my-apps${search}${hash}` : '/my-apps')
          } catch (signInError) {
            if (signInError instanceof DOMException && signInError.name === 'AbortError')
              throw signInError
            throw error
          }
          if (isMyAccountProfile)
            throw new DOMException('Redirecting to Web App sign-in.', 'AbortError')
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
    const scopedURL = scopeWebAppRequestURL(route, address)
    let scopedRequest = input
    if (scopedURL.href !== input.url) {
      scopedRequest = await withWebAppRequestURL(input, scopedURL, Boolean(input.body))
      assertCurrentApp()
    }
    // oxlint-disable-next-line typescript/no-deprecated -- Generated Web calls must retain public passport, auth recovery, and access guard handling.
    const response = await request<Response>(scopedURL.href, init, {
      isPublicAPI: true,
      fetchCompat: true,
      request: scopedRequest,
    })
    assertCurrentApp()
    return response
  },
  interceptors: [validateDefinedErrors(contract)],
})
