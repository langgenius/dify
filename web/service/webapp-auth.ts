import type { WebAppAddress } from './webapp-address'
import { v4 as uuidV4 } from 'uuid'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { getWebAppPassportKey, getWebAppScopeKey } from './webapp-address'

const WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX = 'webapp-authorization-recovery-'

function getWebAppAuthorizationRecoveryKey(address: WebAppAddress) {
  return `${WEB_APP_AUTHORIZATION_RECOVERY_KEY_PREFIX}${getWebAppScopeKey(address)}`
}

export function setWebAppAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
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

export function clearWebAppAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
}

export function clearWebAppPassport(address: WebAppAddress | null) {
  if (!address) return
  localStorage.removeItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address)))
}
