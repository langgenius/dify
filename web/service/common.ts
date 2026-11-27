import type { WebAppAddress } from './webapp-address'
import { webAppLogout as logoutWebApp } from './webapp-auth'
import { webAppClient } from './webapp-client'

export const webAppLogin = (body: { email: string; password: string; remember_me?: boolean }) =>
  webAppClient.login.post({ body })

export const changeWebAppPasswordWithToken = (body: {
  token: string
  new_password: string
  password_confirm: string
}) => webAppClient.forgotPassword.resets.post({ body })

export const uploadPublicRemoteFileInfo = (url: string) => {
  return webAppClient.remoteFiles.upload.post({ body: { url } })
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

export const webAppLogout = (address: WebAppAddress | null) => logoutWebApp(address)
