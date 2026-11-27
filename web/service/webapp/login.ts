import { parseWebAppAddress, removeWebAppBasePath } from '../webapp-address'
import {
  captureWebAppAuthSession,
  setWebAppPassport,
  startWebAppAccountSession,
} from '../webapp-auth'
import { webAppClient } from './index'
import {
  createWebAppLoginProof,
  readWebAppLoginTransaction,
  removeWebAppLoginTransaction,
  storeWebAppLoginTransaction,
} from './login-transaction'

const TRANSACTION_PREFIX = 'webapp-account-login-'
const starts = new Map<string, Promise<string>>()
const exchanges = new Map<
  string,
  { promise: Promise<string>; createdAt: number; isCurrent: () => boolean }
>()

export function isWebAppAccountCallback(pathname: string, params: Pick<URLSearchParams, 'get'>) {
  // Handle malformed direct callbacks here too, before application initialization.
  return (
    params.get('mode') === 'end_user' &&
    parseWebAppAddress(pathname)?.kind === 'default' &&
    params.get('login_code') !== null
  )
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
  removeWebAppLoginTransaction(transactionKey(code))
}
function readTransaction(code: string) {
  return readWebAppLoginTransaction(transactionKey(code))
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
    const { verifier, challenge } = await createWebAppLoginProof()
    if (!isSameSession() || window.location.href !== originalUrl)
      throw new DOMException('The Web App login changed.', 'AbortError')
    storeWebAppLoginTransaction(transactionKey(target.address.code), verifier, target.url)
    login.searchParams.set('is_end_user', '1')
    login.searchParams.set('app_code', target.address.code)
    const returnUrl = new URL(target.url)
    login.searchParams.set(
      'redirect_url',
      `${removeWebAppBasePath(returnUrl.pathname)}${returnUrl.search}${returnUrl.hash}`,
    )
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
  const currentAddress = parseWebAppAddress(window.location.pathname)
  if (
    currentAddress?.kind !== 'default' ||
    window.location.pathname !== new URL(target.url).pathname
  )
    return Promise.reject(new Error('Invalid Web App login callback.'))
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
  let isSameSession = captureWebAppAuthSession()
  const originalUrl = window.location.href
  const operation = (async () => {
    try {
      const { access_token } = await webAppClient.passport.post(
        {
          headers: { 'X-App-Code': target.address.code },
          body: { login_code: loginCode, code_verifier: transaction.verifier },
        },
        { context: { address: target.address } },
      )
      if (
        !isSameSession() ||
        window.location.href !== originalUrl ||
        readTransaction(target.address.code)?.verifier !== transaction.verifier
      )
        throw new DOMException('The Web App login changed.', 'AbortError')
      startWebAppAccountSession()
      setWebAppPassport(target.address, access_token, 'authenticated', 'end_user')
      // Deduplicate remounts against the new session created by this exchange.
      isSameSession = captureWebAppAuthSession()
      removeTransaction(target.address.code)
      return target.url
    } catch (error) {
      if (readTransaction(target.address.code)?.verifier === transaction.verifier)
        removeTransaction(target.address.code)
      throw error
    }
  })()
  exchanges.set(key, {
    promise: operation,
    createdAt: Date.now(),
    isCurrent: () => isSameSession(),
  })
  void operation.catch(() => exchanges.delete(key))
  return operation
}
