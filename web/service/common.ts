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
