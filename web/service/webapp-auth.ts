import { STORAGE_KEYS } from '@/config/storage-keys'
import { storage } from '@/utils/storage'
import { getPublic, postPublic } from './base'

export function setWebAppAccessToken(token: string) {
  storage.set(STORAGE_KEYS.AUTH.ACCESS_TOKEN, token)
}

export function setWebAppPassport(shareCode: string, token: string) {
  storage.set(`passport-${shareCode}`, token)
}

export function getWebAppAccessToken() {
  return storage.get<string>(STORAGE_KEYS.AUTH.ACCESS_TOKEN) || ''
}

export function getWebAppPassport(shareCode: string) {
  return storage.get<string>(`passport-${shareCode}`) || ''
}

export function clearWebAppAccessToken() {
  storage.remove(STORAGE_KEYS.AUTH.ACCESS_TOKEN)
}

export function clearWebAppPassport(shareCode: string) {
  storage.remove(`passport-${shareCode}`)
}

type isWebAppLogin = {
  logged_in: boolean
  app_logged_in: boolean
}

export async function webAppLoginStatus(shareCode: string, userId?: string) {
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
  clearWebAppAccessToken()
  clearWebAppPassport(shareCode)
  await postPublic('/logout')
}
