import { atom, createStore } from 'jotai/vanilla'
import { env } from '@/env'
import { parseWebAppAddress } from '@/service/webapp-address'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'

export type IpAccessScope = Readonly<{ key: string; epoch: number }>

type IpAccessDenied = {
  scope: IpAccessScope
  clientIp?: string
}

type IpAccessDeniedResponse = {
  code: 'ip_access_denied'
  client_ip?: unknown
}

export const ipAccessDeniedAtom = atom<IpAccessDenied | null>(null)
export const ipAccessStore = createStore()

let currentScope: IpAccessScope | null = null
let scopeEpoch = 0
const handledErrors = new WeakSet<object>()

function withoutBasePath(pathname: string) {
  const prefix = env.NEXT_PUBLIC_BASE_PATH
  return prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? pathname.slice(prefix.length) || '/'
    : pathname
}

export function getIpAccessScopeKey(pathname: string, search = '', origin?: string): string | null {
  const path = withoutBasePath(pathname)
  const address = parseWebAppAddress(path)
  if (address) return `webapp:${address.kind}:${address.code}`

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
export function captureIpAccessScope(): IpAccessScope | null {
  if (typeof globalThis.location === 'undefined') return null

  const { pathname, search, origin } = globalThis.location
  const key = getIpAccessScopeKey(pathname, search, origin)
  if (key !== (currentScope?.key ?? null)) {
    currentScope = key ? { key, epoch: ++scopeEpoch } : null
    ipAccessStore.set(ipAccessDeniedAtom, null)
  }
  return currentScope
}

export function isIpAccessScopeCurrent(scope: IpAccessScope | null) {
  return scope === null || captureIpAccessScope() === scope
}

export function hasIpAccessDenied(scope: IpAccessScope | null) {
  return scope !== null && ipAccessStore.get(ipAccessDeniedAtom)?.scope === scope
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
export function handleIpAccessDenied(
  status: number,
  data: unknown,
  scope: IpAccessScope | null,
  error?: object,
) {
  if (!scope || !isIpAccessDeniedResponse(status, data)) return false

  if (error) handledErrors.add(error)
  if (!isIpAccessScopeCurrent(scope)) return true

  const clientIp =
    typeof data.client_ip === 'string' ? data.client_ip.trim() || undefined : undefined
  const previous = ipAccessStore.get(ipAccessDeniedAtom)
  if (previous?.scope !== scope || (!previous.clientIp && clientIp))
    ipAccessStore.set(ipAccessDeniedAtom, { scope, clientIp })

  return true
}

export function isIpAccessDeniedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && handledErrors.has(error)
}
