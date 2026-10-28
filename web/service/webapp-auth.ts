import type { WebAppAddress } from './webapp-address'
import { v4 as uuidV4 } from 'uuid'
import {
  ACCESS_TOKEN_LOCAL_STORAGE_NAME,
  AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME,
  PASSPORT_LOCAL_STORAGE_NAME,
} from '@/config'
import { getWebAppPassportKey, getWebAppScopeKey, resolveWebAppAddress } from './webapp-address'

const WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX = 'webapp-authorization-recovery-'
const WEB_APP_LOGIN_MODE_KEY = 'webapp_login_mode'
const sessionListeners = new Set<() => void>()
let sessionRevision = 0

export type WebAppPassportSource = 'anonymous' | 'authenticated'

function notifySessionChanged() {
  sessionRevision += 1
  for (const listener of sessionListeners) listener()
}

function clearPassports(prefix: string) {
  // oxlint-disable-next-line no-restricted-globals -- Enumerate only the selected credential namespace without deleting session IDs or other credentials.
  const passportKeys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
  // oxlint-disable-next-line no-restricted-globals -- Credential invalidation must complete synchronously before any new request.
  for (const key of passportKeys) localStorage.removeItem(key)
}

function clearAuthenticatedWebAppPassports() {
  clearPassports(AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME(''))
  const recoveryKeys = Object.keys(sessionStorage).filter((key) =>
    key.startsWith(WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX),
  )
  for (const key of recoveryKeys) sessionStorage.removeItem(key)
}

function handleStorageChange(event: StorageEvent) {
  // oxlint-disable-next-line no-restricted-globals -- The credential boundary owns cross-tab identity changes in this storage area.
  if (event.storageArea && event.storageArea !== localStorage) return
  if (
    event.key === ACCESS_TOKEN_LOCAL_STORAGE_NAME ||
    event.key === WEB_APP_LOGIN_MODE_KEY ||
    event.key === null
  )
    notifySessionChanged()
}

/** An opaque session revision, suitable for query keys without exposing credentials. */
export function getWebAppAuthSessionSnapshot() {
  return sessionRevision
}

/** Capture account identity without publishing the credential to callers or cache keys. */
export function captureWebAppAuthSession() {
  const revision = sessionRevision
  const token = getWebAppAccessToken()
  const mode = getWebAppLoginMode()
  return () =>
    sessionRevision === revision &&
    getWebAppAccessToken() === token &&
    getWebAppLoginMode() === mode
}

export function subscribeWebAppAuthSession(listener: () => void) {
  if (sessionListeners.size === 0) window.addEventListener('storage', handleStorageChange)
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
    if (sessionListeners.size === 0) window.removeEventListener('storage', handleStorageChange)
  }
}

/** Invalidate account-bound credentials while retaining anonymous Passports and history. */
export function expireWebAppAccountSession() {
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
  // oxlint-disable-next-line no-restricted-globals -- Keep the credential source marker in the same synchronous storage boundary as the proof.
  localStorage.removeItem(WEB_APP_LOGIN_MODE_KEY)
  clearAuthenticatedWebAppPassports()
  notifySessionChanged()
}

function getWebAppAuthorizationRecoveryKey(address: WebAppAddress) {
  return `${WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX}${getWebAppScopeKey(address)}`
}

export function getWebAppLoginMode(): 'end_user' | 'console' {
  // oxlint-disable-next-line no-restricted-globals -- Request/bootstrap owners must synchronously distinguish account proof from legacy SSO credentials.
  return localStorage.getItem(WEB_APP_LOGIN_MODE_KEY) === 'end_user' ? 'end_user' : 'console'
}

export function setWebAppAccessToken(token: string, mode: 'end_user' | 'console' = 'console') {
  if (getWebAppAccessToken() === token && getWebAppLoginMode() === mode) return
  clearAuthenticatedWebAppPassports()
  // oxlint-disable-next-line no-restricted-globals -- Persist credential provenance alongside the existing proof for refresh and legacy SSO compatibility.
  localStorage.setItem(WEB_APP_LOGIN_MODE_KEY, mode)
  localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
  notifySessionChanged()
}

/** Record a newly issued HttpOnly account session without exposing its login proof. */
export function startWebAppAccountSession() {
  clearAuthenticatedWebAppPassports()
  // oxlint-disable-next-line no-restricted-globals -- Cookie login must remove any legacy bearer before new account requests begin.
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
  // oxlint-disable-next-line no-restricted-globals -- Reset the mode so other tabs observe a cookie-session replacement even when the mode stays end_user.
  localStorage.removeItem(WEB_APP_LOGIN_MODE_KEY)
  // oxlint-disable-next-line no-restricted-globals -- Persist only the login mode; the account proof belongs to the HttpOnly cookie.
  localStorage.setItem(WEB_APP_LOGIN_MODE_KEY, 'end_user')
  notifySessionChanged()
}

function getPassportStorageKey(address: WebAppAddress, source: WebAppPassportSource) {
  const key = getWebAppPassportKey(address)
  return source === 'authenticated'
    ? AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME(key)
    : PASSPORT_LOCAL_STORAGE_NAME(key)
}

export function setWebAppPassport(
  address: WebAppAddress,
  token: string,
  source: WebAppPassportSource = getWebAppLoginMode() === 'end_user' || getWebAppAccessToken()
    ? 'authenticated'
    : 'anonymous',
) {
  localStorage.setItem(getPassportStorageKey(address, source), token)
}

function readWebAppPassport(address: WebAppAddress | null, source: WebAppPassportSource) {
  if (!address) return ''
  return localStorage.getItem(getPassportStorageKey(address, source)) || ''
}

export function getAnonymousWebAppPassport(address: WebAppAddress | null) {
  return readWebAppPassport(address, 'anonymous')
}

export function getAuthenticatedWebAppPassport(address: WebAppAddress | null) {
  return readWebAppPassport(address, 'authenticated')
}

/** Call only after migrating or deleting anonymous history succeeds; Not now retains it. */
export function clearAnonymousWebAppPassports() {
  clearPassports(PASSPORT_LOCAL_STORAGE_NAME(''))
}

export function beginWebAppAuthorizationRecovery(address: WebAppAddress) {
  const key = getWebAppAuthorizationRecoveryKey(address)
  if (sessionStorage.getItem(key)) return false

  sessionStorage.setItem(key, 'pending')
  return true
}

export function completeWebAppAuthorizationRecovery(address: WebAppAddress) {
  sessionStorage.removeItem(getWebAppAuthorizationRecoveryKey(address))
}

export function getWebAppAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME) || ''
}

export function getWebAppPassport(address: WebAppAddress | null) {
  return getAuthenticatedWebAppPassport(address) || getAnonymousWebAppPassport(address)
}

export function getOrCreateWebAppSessionId(address: WebAppAddress) {
  if (address.kind !== 'environment') return ''

  const key = `session_id-${getWebAppScopeKey(address)}`
  // oxlint-disable-next-line no-restricted-globals -- Environment passport requests need a stable session ID synchronously.
  const sessionId = localStorage.getItem(key)
  if (sessionId) return sessionId

  const created = uuidV4()
  // oxlint-disable-next-line no-restricted-globals -- Environment passport requests need a stable session ID synchronously.
  localStorage.setItem(key, created)
  return created
}

export function clearWebAppPassport(address: WebAppAddress | null) {
  if (!address) return
  const source = getAuthenticatedWebAppPassport(address) ? 'authenticated' : 'anonymous'
  localStorage.removeItem(getPassportStorageKey(address, source))
}

export async function webAppLoginStatus(shareCode: string, userId?: string) {
  // always need to check login to prevent passport from being outdated
  // check remotely, the access token could be in cookie (enterprise SSO redirected with https)
  const address = resolveWebAppAddress()
  const { webAppClient } = await import('./webapp')
  const { logged_in, app_logged_in } = await webAppClient.login.status.get({
    query: {
      ...(address?.kind !== 'environment' ? { app_code: shareCode } : {}),
      ...(userId ? { user_id: userId } : {}),
    },
  })
  return {
    userLoggedIn: logged_in,
    appLoggedIn: app_logged_in,
  }
}

export async function webAppLogout(address: WebAppAddress | null) {
  const isAuthSessionCurrent = captureWebAppAuthSession()
  try {
    const { webAppClient } = await import('./webapp')
    if (!isAuthSessionCurrent())
      throw new DOMException('The Web App account changed.', 'AbortError')
    await webAppClient.logout.post(undefined, { context: address ? { address } : {} })
  } finally {
    if (isAuthSessionCurrent()) expireWebAppAccountSession()
  }
}
