import type { RequestGuard } from './request-guard'
import type { OnUploadProgress } from './xhr-fetch'
import { ORPCError } from '@orpc/client'
import { discardRegistrationSessionState } from '@/app/components/base/amplitude/registration-session-state'
import { asyncRunSafe } from '@/utils'
import { isClient } from '@/utils/client'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'
import { basePath } from '@/utils/var'
import { base } from './fetch'
import { markErrorHandled } from './handled-error'
import { isTransientHttpError } from './http-error'
import { refreshAccessTokenOrReLogin } from './refresh-token'
import { captureRequestGuard } from './request-guard'
import { resolveWebAppAddress } from './webapp-address'
import {
  beginWebAppAuthorizationRecovery,
  captureWebAppAuthSession,
  clearWebAppPassport,
  completeWebAppAuthorizationRecovery,
  getWebAppLoginMode,
} from './webapp-auth'

const TIME_OUT = 100000

const canRecoverWebAppAuthorization = (guard: RequestGuard | undefined) =>
  guard?.isActive() !== false

const isWebAppAuthorizationEndpoint = (url: string) =>
  /\/(?:login(?:\/|\?|$)|passport(?:\?|$))/.test(url)

const recoverWebAppAuthorization = (
  error: { code?: string | number; message?: string; reason?: unknown },
  url?: string,
) => {
  const address = resolveWebAppAddress()
  if (
    !address ||
    (address.kind !== 'environment' && getWebAppLoginMode(address) !== 'end_user') ||
    (error.reason !== 'APPDEPLOY_UNAUTHORIZED' && error.code !== 'unauthorized') ||
    (url && isWebAppAuthorizationEndpoint(url))
  )
    return false

  if (!beginWebAppAuthorizationRecovery(address)) {
    if (address.kind === 'environment') {
      requiredWebSSOLogin(error.message, 403)
      return true
    }
    return false
  }

  clearWebAppPassport(address)
  window.location.reload()
  return true
}

const handleWebAppAuthorizationError = (
  error: { code?: string | number; message?: string; reason?: unknown },
  url?: string,
) => {
  if (
    error.reason === 'APPDEPLOY_WEB_APP_ACCESS_DENIED' ||
    error.code === 'web_app_access_denied'
  ) {
    requiredWebSSOLogin(error.message, 403)
    return true
  }
  return recoverWebAppAuthorization(error, url)
}

export type IOtherOptions = {
  isPublicAPI?: boolean
  /** Account-wide Web APIs authenticate with the login Cookie, without an App Passport. */
  isWebAppAccountAPI?: boolean
  isMarketplaceAPI?: boolean
  bodyStringify?: boolean
  needAllResponseContent?: boolean
  deleteContentType?: boolean
  handleUnauthorizedLocally?: boolean

  /** If true, behaves like standard fetch: no URL prefix, returns raw Response */
  fetchCompat?: boolean
  request?: Request
  /** Sends the request over XHR to report request-body upload progress. */
  onUploadProgress?: OnUploadProgress
  /**
   * `false` lifts the time limit on the response headers. Event streams send their headers with
   * the first frame, which can take longer than the limit; abort them through their signal.
   */
  timeout?: false

  getAbortController?: (abortController: AbortController) => void
}

const discardRegistrationStateForConsoleAuthBoundary = ({
  isMarketplaceAPI,
  isPublicAPI,
}: IOtherOptions) => {
  if (isMarketplaceAPI || isPublicAPI) return
  discardRegistrationSessionState()
}

function jumpTo(url: string) {
  if (!url || !isClient) return
  const targetPath = new URL(url, window.location.origin).pathname
  if (targetPath === window.location.pathname) return
  window.location.href = url
}

const OAUTH_AUTHORIZE_PATH = '/account/oauth/authorize'
const SIGNIN_PATH = '/signin'

export const buildSigninUrlWithRedirect = (): string => {
  const loginUrl = `${isClient ? window.location.origin : ''}${basePath}/signin`
  if (!isClient) return loginUrl

  const signinPath = `${basePath}${SIGNIN_PATH}`
  if (window.location.pathname === signinPath || window.location.pathname === `${signinPath}/`)
    return loginUrl

  if (window.location.pathname.includes(OAUTH_AUTHORIZE_PATH)) {
    const currentUrl = window.location.href
    return `${loginUrl}?redirect_url=${encodeURIComponent(currentUrl)}`
  }

  const currentTarget = resolveLoginRedirectTarget(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    { allowSameOriginAbsolute: false },
  )
  if (!currentTarget || currentTarget.kind !== 'internal') return loginUrl

  return `${loginUrl}?redirect_url=${encodeURIComponent(currentTarget.href)}`
}

const WBB_APP_LOGIN_PATH = '/webapp-signin'

export function isWebAppSigninPath(pathname: string) {
  const basePathSegment = basePath.replace(/^\/+|\/+$/g, '')
  const signinPath = `${basePathSegment ? `/${basePathSegment}` : ''}${WBB_APP_LOGIN_PATH}`
  return pathname === signinPath || pathname === `${signinPath}/`
}

export function buildWebAppSigninUrlWithRedirect(
  origin: string,
  pathname: string,
  search: string,
  message?: string,
  code?: number,
) {
  const params = new URLSearchParams()
  params.set('redirect_url', `${pathname}${search}`)
  if (message) params.set('message', message)
  if (code) params.set('code', String(code))

  return `${origin}${basePath}${WBB_APP_LOGIN_PATH}?${params.toString()}`
}

function requiredWebSSOLogin(message?: string, code?: number) {
  if (!isClient) return

  // prevent redirect loop
  if (isWebAppSigninPath(window.location.pathname)) return

  window.location.href = buildWebAppSigninUrlWithRedirect(
    window.location.origin,
    window.location.pathname,
    window.location.search,
    message,
    code,
  )
}

const baseFetch = base

// base request
/** @deprecated Use generated contract clients for new APIs. Special transports require a scoped lint exception. */
export const request = async <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  try {
    const otherOptionsForBaseFetch = otherOptions || {}
    const { isPublicAPI = false } = otherOptionsForBaseFetch
    const requestGuard = captureRequestGuard(
      url,
      isPublicAPI,
      otherOptions?.request?.method || (options as RequestInit).method,
    )
    const isAuthSessionCurrent = isPublicAPI ? captureWebAppAuthSession() : () => true
    const [err, resp] = await asyncRunSafe<T>(baseFetch(url, options, otherOptionsForBaseFetch))
    if (!isAuthSessionCurrent())
      return Promise.reject(new DOMException('The Web App account changed.', 'AbortError'))
    if (err === null) {
      const address = resolveWebAppAddress()
      if (
        isPublicAPI &&
        canRecoverWebAppAuthorization(requestGuard) &&
        address &&
        (address.kind === 'environment' || getWebAppLoginMode(address) === 'end_user') &&
        !isWebAppAuthorizationEndpoint(url)
      )
        completeWebAppAuthorizationRecovery(address)
      return resp
    }
    if (err instanceof ORPCError && requestGuard?.handleError(err.status, err.data, err))
      return Promise.reject(err)
    if (requestGuard?.isActive() === false) return Promise.reject(err)
    if (
      err instanceof ORPCError &&
      err.status === 401 &&
      err.code !== 'unauthorized_and_force_logout' &&
      otherOptionsForBaseFetch.handleUnauthorizedLocally
    )
      return Promise.reject(err)
    if (err instanceof ORPCError && (err.status === 401 || (err.status === 403 && isPublicAPI))) {
      if (!isClient) return Promise.reject(err)
      if (otherOptionsForBaseFetch.isWebAppAccountAPI) return Promise.reject(err)

      const errRespData = { code: err.code, message: err.message, reason: err.data?.reason }
      if (!err.data) {
        if (err.status === 401 && !isPublicAPI) {
          discardRegistrationStateForConsoleAuthBoundary(otherOptionsForBaseFetch)
          window.location.href = buildSigninUrlWithRedirect()
        }
        return Promise.reject(err)
      }
      if (/\/login/.test(url)) return Promise.reject(err)
      if (isPublicAPI && err.code === 'end_user_login_required') return Promise.reject(err)
      // A WebApp sign-in redirect is the feedback for these errors.
      if (handleWebAppAuthorizationError(errRespData, url)) {
        markErrorHandled(err)
        return Promise.reject(err)
      }
      // special code
      const { code } = errRespData
      if (code === 'web_sso_auth_required') {
        markErrorHandled(err)
        requiredWebSSOLogin()
        return Promise.reject(err)
      }
      if (err.status === 403) return Promise.reject(err)
      if (code === 'unauthorized_and_force_logout') {
        // Cookies will be cleared by the backend
        discardRegistrationStateForConsoleAuthBoundary(otherOptionsForBaseFetch)
        window.location.reload()
        return Promise.reject(err)
      }
      if (isPublicAPI && code === 'unauthorized') {
        if (getWebAppLoginMode(resolveWebAppAddress()) !== 'end_user') {
          markErrorHandled(err)
          requiredWebSSOLogin()
        }
        return Promise.reject(err)
      }
      // The init page shows a wrong password at its field.
      if (code === 'init_validate_failed') return Promise.reject(err)
      if (code === 'not_init_validated') {
        jumpTo(`${window.location.origin}${basePath}/init`)
        return Promise.reject(err)
      }
      if (code === 'not_setup') {
        jumpTo(`${window.location.origin}${basePath}/install`)
        return Promise.reject(err)
      }

      // Web account proofs have no Console refresh-token flow. The Webapp owner
      // checks end_user login status and prepares a new App Passport when needed.
      if (isPublicAPI) return Promise.reject(err)

      // refresh token
      const [refreshErr] = await asyncRunSafe(refreshAccessTokenOrReLogin(TIME_OUT))
      if (refreshErr === null) return baseFetch<T>(url, options, otherOptionsForBaseFetch)
      // Preserve the transient failure so callers can retry instead of treating the session as ended.
      if (isTransientHttpError(refreshErr)) return Promise.reject(refreshErr)
      // /device is the device-flow chooser; logged-out is a valid state
      // there. Redirecting to /signin loses the user_code context and
      // the post-login flow lands on /apps instead of returning here.
      if (window.location.pathname === `${basePath}/device`) return Promise.reject(err)
      discardRegistrationStateForConsoleAuthBoundary(otherOptionsForBaseFetch)
      // On the sign-in page itself the sign-in forms own the failure, so there is nowhere to go.
      if (window.location.pathname !== `${basePath}/signin`) jumpTo(buildSigninUrlWithRedirect())
      return Promise.reject(err)
    } else {
      return Promise.reject(err)
    }
  } catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
}
