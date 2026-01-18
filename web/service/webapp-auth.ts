import { PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { getPublic, postPublic } from './base'

export function setWebAppPassport(shareCode: string, token: string) {
  localStorage.setItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode), token)
}

export function getWebAppPassport(shareCode: string) {
  return localStorage.getItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode)) || ''
}

export function clearWebAppPassport(shareCode: string) {
  localStorage.removeItem(PASSPORT_LOCAL_STORAGE_NAME(shareCode))
}

type isWebAppLogin = {
  logged_in: boolean
  app_logged_in: boolean
}

export async function webAppLoginStatus(shareCode: string, userId?: string) {
  // always need to check login to prevent passport from being outdated
  // check remotely, the access token could be in cookie (enterprise SSO redirected with https)
  const params = new URLSearchParams({ app_code: shareCode })
  if (userId)
    params.append('user_id', userId)
  const { logged_in, app_logged_in } = await getPublic<isWebAppLogin>(`/login/status?${params.toString()}`)
  return {
    userLoggedIn: logged_in,
    appLoggedIn: app_logged_in,
  }
}

export async function webAppLogout(shareCode: string) {
  clearWebAppPassport(shareCode)
  await postPublic('/logout')
}
