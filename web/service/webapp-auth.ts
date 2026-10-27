import type { WebAppAddress } from './webapp-address'
import { v4 as uuidV4 } from 'uuid'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { getWebAppPassportKey, getWebAppScopeKey, resolveWebAppAddress } from './webapp-address'

const WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX = 'webapp-authorization-recovery-'
const WEB_APP_LOGIN_MODE_KEY = 'webapp_login_mode'
const sessionListeners = new Set<() => void>()
let sessionRevision = 0

function notifySessionChanged() {
  sessionRevision += 1
  for (const listener of sessionListeners) listener()
}

function clearWebAppPassports() {
  const prefix = PASSPORT_LOCAL_STORAGE_NAME('')
  // oxlint-disable-next-line no-restricted-globals -- Enumerate the existing credential namespace without deleting anonymous session IDs.
  const passportKeys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
  // oxlint-disable-next-line no-restricted-globals -- Identity changes synchronously invalidate existing App Passports before any new request.
  for (const key of passportKeys) localStorage.removeItem(key)
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

/** Invalidate account-bound App credentials while retaining anonymous history/session IDs. */
export function expireWebAppAccountSession() {
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
  // oxlint-disable-next-line no-restricted-globals -- Keep the credential source marker in the same synchronous storage boundary as the proof.
  localStorage.removeItem(WEB_APP_LOGIN_MODE_KEY)
  clearWebAppPassports()
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
  clearWebAppPassports()
  // oxlint-disable-next-line no-restricted-globals -- Persist credential provenance alongside the existing proof for refresh and legacy SSO compatibility.
  localStorage.setItem(WEB_APP_LOGIN_MODE_KEY, mode)
  localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
  notifySessionChanged()
}

export function setWebAppPassport(address: WebAppAddress, token: string) {
  localStorage.setItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address)), token)
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
  if (!address) return ''
  return localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address))) || ''
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
  localStorage.removeItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address)))
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
  try {
    const { webAppClient } = await import('./webapp')
    await webAppClient.logout.post(undefined, { context: address ? { address } : {} })
  } finally {
    expireWebAppAccountSession()
  }
}
