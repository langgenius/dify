import type { WebAppAddress } from './webapp-address'
import { resolveWebAppAddress } from './webapp-address'
import { clearWebAppAccessToken, clearWebAppPassport } from './webapp-auth'
import { webAppClient } from './webapp-client'

type LoginSuccess = {
  result: 'success'
  data?: { access_token?: string }
}
type LoginFail = {
  result: 'fail'
  data: string
  code: string
  message: string
}
type LoginResponse = LoginSuccess | LoginFail

export const webAppLogin = (body: {
  email: string
  password: string
  remember_me?: boolean
}): Promise<LoginResponse> => {
  return webAppClient.login.post({ body }) as Promise<LoginResponse>
}

export const changeWebAppPasswordWithToken = (body: {
  token: string
  new_password: string
  password_confirm: string
}) => webAppClient.forgotPassword.resets.post({ body })

export const uploadPublicRemoteFileInfo = (url: string, options?: { silent?: boolean }) => {
  return webAppClient.remoteFiles.upload.post({ body: { url } }, { context: options }) as Promise<{
    id: string
    name: string
    size: number
    mime_type: string
    url: string
  }>
}

export const sendWebAppEMailLoginCode = (email: string, language = 'en-US') =>
  webAppClient.emailCodeLogin.post({ body: { email, language } })

export const webAppEmailLoginWithCode = (body: { email: string; code: string; token: string }) =>
  webAppClient.emailCodeLogin.validity.post({ body })

export const sendWebAppResetPasswordCode = (email: string, language = 'en-US') =>
  webAppClient.forgotPassword.post({ body: { email, language } })

export const verifyWebAppResetPasswordCode = (body: {
  email: string
  code: string
  token: string
}) => webAppClient.forgotPassword.validity.post({ body })

export async function webAppLoginStatus(shareCode: string, userId?: string) {
  // always need to check login to prevent passport from being outdated
  // check remotely, the access token could be in cookie (enterprise SSO redirected with https)
  const address = resolveWebAppAddress()
  const query: { app_code?: string; user_id?: string } = {}
  if (address?.kind !== 'environment') query.app_code = shareCode
  if (userId) query.user_id = userId
  const { logged_in, app_logged_in } = await webAppClient.login.status.get({ query })
  return {
    userLoggedIn: logged_in,
    appLoggedIn: app_logged_in,
  }
}

export async function webAppLogout(address: WebAppAddress | null) {
  clearWebAppAccessToken()
  clearWebAppPassport(address)
  await webAppClient.logout.post()
}
