import { atom, createStore } from 'jotai/vanilla'
import { z } from 'zod'
import { env } from '@/env'
import { isAppDeletingOrDeleted } from '@/service/app-deletion'
import { parseWebAppAddress } from '@/service/webapp-address'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'

export type AppAccessScope = Readonly<{ key: string; epoch: number }>

type AppAccessError = {
  reason: 'ip_access_denied' | 'app_not_found'
  scope: AppAccessScope
  clientIp?: string
}

type IpAccessDeniedResponse = {
  code: 'ip_access_denied'
  client_ip?: unknown
}

export const appAccessErrorAtom = atom<AppAccessError | null>(null)
export const trialAppAccessErrorAtom = atom<AppAccessError | null>(null)
export const appAccessStore = createStore()
export const trialAppAccessScopeAtom = atom<AppAccessScope | null>(null)

let currentScope: AppAccessScope | null = null
let scopeEpoch = 0
const handledErrors = new WeakSet<object>()

function withoutBasePath(pathname: string) {
  const prefix = env.NEXT_PUBLIC_BASE_PATH
  return prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? pathname.slice(prefix.length) || '/'
    : pathname
}

export function getAppAccessScopeKey(
  pathname: string,
  search = '',
  origin?: string,
): string | null {
  const path = withoutBasePath(pathname)
  const address = parseWebAppAddress(path)
  if (address) return `webapp:${address.kind}:${address.code}`

  const consoleApp = /^\/app\/([^/]+)(?:\/|$)/.exec(path)
  if (consoleApp) return `app:${consoleApp[1]}`
  const agent = /^\/agents\/([^/]+)(?:\/|$)/.exec(path)
  if (agent) return `agent:${agent[1]}`
  const installed = /^\/(?:explore\/)?installed\/([^/]+)(?:\/|$)/.exec(path)
  if (installed) return `installed:${installed[1]}`

  const form = /^\/form\/([^/]+)\/?$/.exec(path)
  if (form) return `form:${form[1]}`

  if (
    path !== '/webapp-signin' &&
    !path.startsWith('/webapp-signin/') &&
    path !== '/webapp-reset-password' &&
    !path.startsWith('/webapp-reset-password/')
  )
    return null

  const redirect = resolveLoginRedirectTarget(new URLSearchParams(search).get('redirect_url'), {
    currentOrigin: origin,
    allowSameOriginAbsolute: Boolean(origin),
  })
  if (!redirect) return null

  const target = new URL(redirect.href, origin || 'https://login-redirect.invalid')
  const redirectAddress = parseWebAppAddress(withoutBasePath(target.pathname))
  return redirectAddress ? `webapp:${redirectAddress.kind}:${redirectAddress.code}` : null
}

/** Capture the route before sending a request, including its current visit. */
export function captureAppAccessScope(): AppAccessScope | null {
  if (typeof globalThis.location === 'undefined') return null

  const { pathname, search, origin } = globalThis.location
  const key = getAppAccessScopeKey(pathname, search, origin)
  if (key !== (currentScope?.key ?? null)) {
    currentScope = key ? { key, epoch: ++scopeEpoch } : null
    appAccessStore.set(appAccessErrorAtom, null)
  }
  return currentScope
}

export function isAppAccessScopeCurrent(scope: AppAccessScope | null) {
  return scope?.key.startsWith('trial:')
    ? scope === appAccessStore.get(trialAppAccessScopeAtom)
    : scope === null || captureAppAccessScope() === scope
}

export function hasAppAccessError(scope: AppAccessScope | null) {
  return scope !== null && appAccessStore.get(errorAtomFor(scope))?.scope === scope
}

export function isIpAccessDeniedResponse(
  status: number,
  data: unknown,
): data is IpAccessDeniedResponse {
  return (
    status === 403 &&
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'ip_access_denied'
  )
}

/** A handled denial stays an error for callers, without triggering auth recovery or toasts. */
export function handleAppAccessError(
  status: number,
  data: unknown,
  scope: AppAccessScope | null,
  error?: object,
  appIdentity = false,
) {
  if (scope?.key.startsWith('form:') && status === 404) return false
  if (!scope || !isAppAccessErrorResponse(status, data, appIdentity)) return false
  if (isScopeBeingDeleted(scope)) return false

  if (error) handledErrors.add(error)
  if (!isAppAccessScopeCurrent(scope)) return true

  const clientIp = getClientIp(data)
  const errorAtom = errorAtomFor(scope)
  const previous = appAccessStore.get(errorAtom)
  if (previous?.scope !== scope || (!previous.clientIp && clientIp))
    appAccessStore.set(errorAtom, {
      scope,
      clientIp,
      reason: previous?.reason ?? (status === 403 ? 'ip_access_denied' : 'app_not_found'),
    })

  return true
}

export function isAppAccessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && handledErrors.has(error)
}

const ipAddressSchema = z.union([z.ipv4(), z.ipv6()])

/** Only render a single IP supplied by the response, never an address list or a placeholder. */
export function getClientIp(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('client_ip' in data)) return undefined
  const value = typeof data.client_ip === 'string' ? data.client_ip.trim() : undefined
  return ipAddressSchema.safeParse(value).success ? value : undefined
}

export function isAppAccessErrorResponse(status: number, data: unknown, appIdentity = false) {
  return (
    isIpAccessDeniedResponse(status, data) ||
    (status === 404 &&
      (appIdentity ||
        (typeof data === 'object' &&
          data !== null &&
          'code' in data &&
          data.code === 'app_not_found')))
  )
}

/** Match the request to the captured route; unrelated resource 404s keep their own owner. */
export function captureAppAccessRequest(url: string, isPublicAPI = false, method = 'GET') {
  const scope = captureAppAccessScope()
  const none = { scope: null, appIdentity: false }
  const target = new URL(url, 'https://app-request.invalid')
  const path = target.pathname.replace(/\/$/, '')
  const trial = /\/trial-apps\/([^/]+)(\/.*)?$/.exec(path)
  if (!isPublicAPI && trial) {
    const trialScope = appAccessStore.get(trialAppAccessScopeAtom)
    if (trialScope?.key !== `trial:${trial[1]}`) return none
    return {
      scope: trialScope,
      appIdentity: method.toUpperCase() === 'GET' && (!trial[2] || trial[2] === '/parameters'),
    }
  }
  if (!scope) return none
  if (isPublicAPI) {
    if (scope.key.startsWith('form:')) {
      const token = /\/form\/human_input\/([^/]+)/.exec(path)?.[1]
      return token && scope.key !== `form:${token}` ? none : { scope, appIdentity: false }
    }
    if (!scope.key.startsWith('webapp:')) return none
    const code = scope.key.split(':').slice(2).join(':')
    const requestedCode = target.searchParams.get('appCode') || target.searchParams.get('app_code')
    const environmentCode = /\/environment\/([^/]+)\//.exec(path)?.[1]
    if ((requestedCode && requestedCode !== code) || (environmentCode && environmentCode !== code))
      return none
    const appIdentity =
      /\/(?:site|parameters|meta|passport|login\/status|webapp\/access-mode)$/.test(path)
    return { scope, appIdentity }
  }
  const resource = /\/(apps|agent|installed-apps)\/([^/]+)(\/.*)?$/.exec(path)
  if (!resource) return none
  const [, kind, id, suffix] = resource
  const prefix = kind === 'apps' ? 'app' : kind === 'agent' ? 'agent' : 'installed'
  if (scope.key !== `${prefix}:${id}` || isScopeBeingDeleted(scope)) return none
  return {
    scope,
    appIdentity:
      method.toUpperCase() === 'GET' &&
      (!suffix || (prefix === 'installed' && ['/parameters', '/meta'].includes(suffix))),
  }
}

export function throwIfAppAccessBlocked(scope: AppAccessScope | null) {
  if (!hasAppAccessError(scope)) return
  const error = new DOMException('The app is no longer accessible.', 'AbortError')
  handledErrors.add(error)
  throw error
}

function isScopeBeingDeleted(scope: AppAccessScope) {
  return isAppDeletingOrDeleted(scope.key.startsWith('app:') ? scope.key.slice(4) : scope.key)
}

function errorAtomFor(scope: AppAccessScope) {
  return scope.key.startsWith('trial:') ? trialAppAccessErrorAtom : appAccessErrorAtom
}

/** The dialog registers before mounting request owners and retires the visit on close. */
export function beginTrialAppAccess(appId: string): AppAccessScope {
  const trialScope = { key: `trial:${appId}`, epoch: ++scopeEpoch }
  appAccessStore.set(trialAppAccessScopeAtom, trialScope)
  appAccessStore.set(trialAppAccessErrorAtom, null)
  return trialScope
}

export function endTrialAppAccess(scope: AppAccessScope) {
  if (appAccessStore.get(trialAppAccessScopeAtom) !== scope) return
  appAccessStore.set(trialAppAccessScopeAtom, null)
  appAccessStore.set(trialAppAccessErrorAtom, null)
}
