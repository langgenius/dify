import { basePath } from '@/utils/var'
import { parseWebAppAddress } from '../webapp-address'
import { captureWebAppAuthSession } from '../webapp-auth'
import { webAppClient } from './index'

const TRANSACTION_PREFIX = 'webapp-account-login-'
const TRANSACTION_TTL = 30 * 60 * 1000
type Transaction = { verifier: string; redirectUrl: string; createdAt: number }
const starts = new Map<string, Promise<string>>()
const exchanges = new Map<
  string,
  { promise: Promise<string>; createdAt: number; isCurrent: () => boolean }
>()

export function isWebAppAccountCallback(pathname: string, params: Pick<URLSearchParams, 'get'>) {
  const prefix = basePath.replace(/\/$/, '')
  const path =
    prefix && pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname
  if (path !== '/webapp-signin' || params.get('mode') !== 'end_user') return false
  try {
    const target = new URL(params.get('redirect_url') || '', 'https://login-redirect.invalid')
    return (
      ['http:', 'https:'].includes(target.protocol) &&
      !target.username &&
      !target.password &&
      parseWebAppAddress(target.pathname)?.kind === 'default'
    )
  } catch {
    return false
  }
}

export function resolveWebAppAccountReturn(raw: string | null) {
  if (!raw || raw.includes('\\') || /[\u0000-\u001F\u007F]/.test(raw)) return null
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin || url.username || url.password) return null
    const address = parseWebAppAddress(url.pathname)
    if (address?.kind !== 'default') return null
    return { address, url: url.href }
  } catch {
    return null
  }
}

function transactionKey(code: string) {
  return `${TRANSACTION_PREFIX}${code}`
}
function removeTransaction(code: string) {
  try {
    sessionStorage.removeItem(transactionKey(code))
  } catch {}
}
function readTransaction(code: string): Transaction | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(transactionKey(code)) || 'null')
    if (
      value &&
      typeof value === 'object' &&
      'verifier' in value &&
      typeof value.verifier === 'string' &&
      /^[\w-]{43}$/.test(value.verifier) &&
      'redirectUrl' in value &&
      typeof value.redirectUrl === 'string' &&
      'createdAt' in value &&
      typeof value.createdAt === 'number' &&
      Date.now() >= value.createdAt &&
      Date.now() - value.createdAt < TRANSACTION_TTL
    )
      return {
        verifier: value.verifier,
        redirectUrl: value.redirectUrl,
        createdAt: value.createdAt,
      }
  } catch {}
  removeTransaction(code)
  return null
}
function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Only the challenge leaves the Web origin; the verifier stays in this tab. */
export function beginWebAppAccountLogin(
  accountLoginUrl: string,
  rawRedirect: string,
): Promise<string> {
  const target = resolveWebAppAccountReturn(rawRedirect)
  if (!target) return Promise.reject(new Error('Invalid Web App login target.'))
  const key = `${accountLoginUrl}:${target.url}`
  const existing = starts.get(key)
  if (existing) return existing
  const isSameSession = captureWebAppAuthSession()
  const originalUrl = window.location.href
  const operation = (async () => {
    const login = new URL(accountLoginUrl, window.location.origin)
    if (
      !['http:', 'https:'].includes(login.protocol) ||
      login.username ||
      login.password ||
      !login.pathname.endsWith('/signin')
    )
      throw new Error('Invalid Account sign-in URL.')
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
    const challenge = base64Url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    )
    if (!isSameSession() || window.location.href !== originalUrl)
      throw new DOMException('The Web App login changed.', 'AbortError')
    sessionStorage.setItem(
      transactionKey(target.address.code),
      JSON.stringify({
        verifier,
        redirectUrl: target.url,
        createdAt: Date.now(),
      } satisfies Transaction),
    )
    login.searchParams.set('is_end_user', '1')
    login.searchParams.set('app_code', target.address.code)
    login.searchParams.set('redirect_url', target.url)
    login.searchParams.set('code_challenge', challenge)
    login.searchParams.set('code_challenge_method', 'S256')
    return login.href
  })()
  starts.set(key, operation)
  void operation.then(
    () => starts.delete(key),
    () => starts.delete(key),
  )
  return operation
}

export function cancelWebAppAccountLogin(rawRedirect: string | null) {
  const target = resolveWebAppAccountReturn(rawRedirect)
  if (target && readTransaction(target.address.code)?.redirectUrl === target.url)
    removeTransaction(target.address.code)
}

/** The backend binds its one-use code to the App and the stored PKCE transaction. */
export function completeWebAppAccountLogin(
  rawRedirect: string | null,
  loginCode: string,
): Promise<string> {
  const target = resolveWebAppAccountReturn(rawRedirect)
  if (!target || !loginCode) return Promise.reject(new Error('Invalid Web App login callback.'))
  const key = `${target.url}:${loginCode}`
  const existing = exchanges.get(key)
  for (const [storedKey, exchange] of exchanges) {
    if (Date.now() - exchange.createdAt >= 60_000 || !exchange.isCurrent())
      exchanges.delete(storedKey)
  }
  if (existing && exchanges.has(key)) return existing.promise
  const transaction = readTransaction(target.address.code)
  if (!transaction || transaction.redirectUrl !== target.url)
    return Promise.reject(new Error('Missing or expired Web App login transaction.'))
  const isSameSession = captureWebAppAuthSession()
  const originalUrl = window.location.href
  const operation = (async () => {
    try {
      await webAppClient.passport.post(
        {
          headers: { 'X-App-Code': target.address.code },
          body: { login_code: loginCode, code_verifier: transaction.verifier },
        },
        { context: { address: target.address, silent: true } },
      )
      if (
        !isSameSession() ||
        window.location.href !== originalUrl ||
        readTransaction(target.address.code)?.verifier !== transaction.verifier
      )
        throw new DOMException('The Web App login changed.', 'AbortError')
      removeTransaction(target.address.code)
      return target.url
    } catch (error) {
      if (readTransaction(target.address.code)?.verifier === transaction.verifier)
        removeTransaction(target.address.code)
      throw error
    }
  })()
  exchanges.set(key, { promise: operation, createdAt: Date.now(), isCurrent: isSameSession })
  void operation.catch(() => exchanges.delete(key))
  return operation
}
