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
const WEB_APP_LOGIN_MODE_PREFIX = `${WEB_APP_LOGIN_MODE_KEY}-`
const sessionListeners = new Set<() => void>()
let sessionRevision = 0

export type WebAppPassportSource = 'anonymous' | 'authenticated'
type WebAppLoginMode = 'end_user' | 'console'

function getCredentialStorage() {
  // oxlint-disable-next-line no-restricted-globals -- Auth transport synchronously reads, invalidates, and enumerates legacy credential keys.
  return localStorage
}

function notifySessionChanged() {
  sessionRevision += 1
  for (const listener of sessionListeners) listener()
}

function clearAuthenticatedWebAppPassports() {
  const storage = getCredentialStorage()
  const passportPrefix = AUTHENTICATED_PASSPORT_LOCAL_STORAGE_NAME('')
  for (const key of Object.keys(storage)) {
    if (key.startsWith(passportPrefix) || key.startsWith(WEB_APP_LOGIN_MODE_PREFIX))
      storage.removeItem(key)
  }
  const recoveryKeys = Object.keys(sessionStorage).filter((key) =>
    key.startsWith(WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX),
  )
  for (const key of recoveryKeys) sessionStorage.removeItem(key)
}

function handleStorageChange(event: StorageEvent) {
  if (event.storageArea && event.storageArea !== getCredentialStorage()) return
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
  getCredentialStorage().removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
  getCredentialStorage().removeItem(WEB_APP_LOGIN_MODE_KEY)
  clearAuthenticatedWebAppPassports()
  notifySessionChanged()
}

function getWebAppAuthorizationRecoveryKey(address: WebAppAddress) {
  return `${WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX}${getWebAppScopeKey(address)}`
}

function getWebAppLoginModeKey(address: WebAppAddress) {
  return `${WEB_APP_LOGIN_MODE_PREFIX}${getWebAppScopeKey(address)}`
}

export function getWebAppLoginMode(address?: WebAppAddress | null): WebAppLoginMode {
  const storage = getCredentialStorage()
  const accountMode = storage.getItem(WEB_APP_LOGIN_MODE_KEY)
  if (address === undefined) return accountMode === 'end_user' ? 'end_user' : 'console'
  if (address?.kind !== 'default') return 'console'

  const appMode = storage.getItem(getWebAppLoginModeKey(address))
  if (appMode === 'end_user' || appMode === 'console') return appMode
  // Existing account sessions can have an authenticated Passport from before app modes were stored.
  return accountMode === 'end_user' && getAuthenticatedWebAppPassport(address)
    ? 'end_user'
    : 'console'
}

export function setWebAppAccessToken(token: string, mode: WebAppLoginMode = 'console') {
  if (getWebAppAccessToken() === token && getWebAppLoginMode() === mode) return
  clearAuthenticatedWebAppPassports()
  getCredentialStorage().setItem(WEB_APP_LOGIN_MODE_KEY, mode)
  getCredentialStorage().setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
  notifySessionChanged()
}

/** Record a newly issued HttpOnly account session without exposing its login proof. */
export function startWebAppAccountSession() {
  clearAuthenticatedWebAppPassports()
  getCredentialStorage().removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
  getCredentialStorage().removeItem(WEB_APP_LOGIN_MODE_KEY)
  getCredentialStorage().setItem(WEB_APP_LOGIN_MODE_KEY, 'end_user')
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
  mode: WebAppLoginMode = 'console',
) {
  if (source === 'authenticated' && address.kind === 'default')
    getCredentialStorage().setItem(getWebAppLoginModeKey(address), mode)
  getCredentialStorage().setItem(getPassportStorageKey(address, source), token)
}

function readWebAppPassport(address: WebAppAddress | null, source: WebAppPassportSource) {
  if (!address) return ''
  return getCredentialStorage().getItem(getPassportStorageKey(address, source)) || ''
}

export function getAnonymousWebAppPassport(address: WebAppAddress | null) {
  return readWebAppPassport(address, 'anonymous')
}

export function getAnonymousWebAppPassports() {
  const prefix = PASSPORT_LOCAL_STORAGE_NAME('')
  return Object.keys(getCredentialStorage())
    .filter((key) => key.startsWith(prefix))
    .flatMap((key) => {
      const passport = getCredentialStorage().getItem(key)
      return passport ? [{ key, passport }] : []
    })
}

export function removeAnonymousWebAppPassport(candidate: { key: string; passport: string }) {
  if (!candidate.key.startsWith(PASSPORT_LOCAL_STORAGE_NAME(''))) return
  // A concurrent tab may have already replaced the Passport being migrated.
  if (getCredentialStorage().getItem(candidate.key) === candidate.passport)
    getCredentialStorage().removeItem(candidate.key)
}

export function getAuthenticatedWebAppPassport(address: WebAppAddress | null) {
  return readWebAppPassport(address, 'authenticated')
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
  return getCredentialStorage().getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME) || ''
}

export function getWebAppPassport(address: WebAppAddress | null) {
  return getAuthenticatedWebAppPassport(address) || getAnonymousWebAppPassport(address)
}

export function getOrCreateWebAppSessionId(address: WebAppAddress) {
  if (address.kind !== 'environment') return ''

  const key = `session_id-${getWebAppScopeKey(address)}`
  const sessionId = getCredentialStorage().getItem(key)
  if (sessionId) return sessionId

  const created = uuidV4()
  getCredentialStorage().setItem(key, created)
  return created
}

export function clearWebAppPassport(address: WebAppAddress | null) {
  if (!address) return
  const source = getAuthenticatedWebAppPassport(address) ? 'authenticated' : 'anonymous'
  getCredentialStorage().removeItem(getPassportStorageKey(address, source))
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
  const { webAppClient } = await import('./webapp')
  if (!isAuthSessionCurrent()) throw new DOMException('The Web App account changed.', 'AbortError')
  try {
    await webAppClient.logout.post(undefined, {
      context: address ? { address } : {},
    })
  } finally {
    if (isAuthSessionCurrent()) {
      if (address) getCredentialStorage().removeItem(getPassportStorageKey(address, 'anonymous'))
      expireWebAppAccountSession()
    }
  }
}
