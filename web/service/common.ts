import type { WebAppAddress } from './webapp-address'
import {
  webAppLoginStatus as getWebAppLoginStatus,
  webAppLogout as logoutWebApp,
} from './webapp-auth'
import { webAppClient } from './webapp-client'

export const webAppLogin = (body: { email: string; password: string; remember_me?: boolean }) =>
  webAppClient.login.post({ body })

export const changeWebAppPasswordWithToken = (body: {
  token: string
  new_password: string
  password_confirm: string
}) => webAppClient.forgotPassword.resets.post({ body })

export const uploadPublicRemoteFileInfo = (url: string, options?: { silent?: boolean }) => {
  return webAppClient.remoteFiles.upload.post({ body: { url } }, { context: options })
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

export const webAppLoginStatus = (shareCode: string, userId?: string) =>
  getWebAppLoginStatus(shareCode, userId)

export const webAppLogout = (address: WebAppAddress | null, options?: { silent?: boolean }) =>
  logoutWebApp(address, options)
