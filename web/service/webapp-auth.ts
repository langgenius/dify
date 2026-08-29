import type { WebAppAddress } from './webapp-address'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { getPublic, postPublic } from './base'
import { getWebAppPassportKey, getWebAppScopeKey, resolveWebAppAddress } from './webapp-address'

export function setWebAppAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
}

export function setWebAppPassport(address: WebAppAddress, token: string) {
  localStorage.setItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address)), token)
}

export function getWebAppAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME) || ''
}

export function getWebAppPassport(address: WebAppAddress | null) {
  if (!address) return ''
  return localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address))) || ''
}

export function getOrCreateWebAppVisitorId(address: WebAppAddress) {
  if (address.kind !== 'environment') return ''

  const key = `visitor-${getWebAppScopeKey(address)}`
  const visitorId = localStorage.getItem(key)
  if (visitorId) return visitorId

  const created = crypto.randomUUID()
  localStorage.setItem(key, created)
  return created
}

function clearWebAppAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
}

function clearWebAppPassport(address: WebAppAddress | null) {
  if (!address) return
  localStorage.removeItem(PASSPORT_LOCAL_STORAGE_NAME(getWebAppPassportKey(address)))
}

type isWebAppLogin = {
  logged_in: boolean
  app_logged_in: boolean
}

export async function webAppLoginStatus(shareCode: string, userId?: string) {
  // always need to check login to prevent passport from being outdated
  // check remotely, the access token could be in cookie (enterprise SSO redirected with https)
  const address = resolveWebAppAddress()
  const params = new URLSearchParams()
  if (address?.kind !== 'environment') params.set('app_code', shareCode)
  if (userId) params.append('user_id', userId)
  const { logged_in, app_logged_in } = await getPublic<isWebAppLogin>(
    `/login/status?${params.toString()}`,
  )
  return {
    userLoggedIn: logged_in,
    appLoggedIn: app_logged_in,
  }
}

export async function webAppLogout(address: WebAppAddress | null) {
  clearWebAppAccessToken()
  clearWebAppPassport(address)
  await postPublic('/logout')
}
