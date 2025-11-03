import { ACCESS_TOKEN_LOCAL_STORAGE_NAME, PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { getPublic, postPublic } from './base'

export function setWebAppAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, token)
}

export function setWebAppPassport(shareCode: string, token: string) {
  localStorage.setItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode), token)
}

export function getWebAppAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME) || ''
}

export function getWebAppPassport(shareCode: string) {
  return localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode)) || ''
}

export function clearWebAppAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)
}

export function clearWebAppPassport(shareCode: string) {
  localStorage.removeItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode))
}

type isWebAppLogin = {
  logged_in: boolean
  app_logged_in: boolean
}

export async function webAppLoginStatus(shareCode: string) {
  // always need to check login to prevent passport from being outdated
  // check remotely, the access token could be in cookie (enterprise SSO redirected with https)
  const { logged_in, app_logged_in } = await getPublic<isWebAppLogin>(`/login/status?app_code=${shareCode}`)
  return {
    userLoggedIn: logged_in,
    appLoggedIn: app_logged_in,
  }
}

export async function webAppLogout(shareCode: string) {
  clearWebAppAccessToken()
  clearWebAppPassport(shareCode)
  await postPublic('/logout')
}
