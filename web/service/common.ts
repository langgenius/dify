import type { CommonResponse } from '@/models/common'
import { post } from './base'

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
export const webAppLogin = ({
  url,
  body,
}: {
  url: string
  body: Record<string, unknown>
}): Promise<LoginResponse> => {
  return post<LoginResponse>(url, { body }, { isPublicAPI: true })
}

export const changeWebAppPasswordWithToken = ({
  url,
  body,
}: {
  url: string
  body: { token: string; new_password: string; password_confirm: string }
}): Promise<CommonResponse> => post<CommonResponse>(url, { body }, { isPublicAPI: true })

export const uploadRemoteFileInfo = (
  url: string,
  isPublic?: boolean,
  silent?: boolean,
  uploadEndpoint?: string,
): Promise<{ id: string; name: string; size: number; mime_type: string; url: string }> => {
  return post<{ id: string; name: string; size: number; mime_type: string; url: string }>(
    uploadEndpoint || '/remote-files/upload',
    { body: { url } },
    { isPublicAPI: isPublic, silent },
  )
}

export const sendWebAppEMailLoginCode = (
  email: string,
  language = 'en-US',
): Promise<CommonResponse & { data: string }> =>
  post<CommonResponse & { data: string }>(
    '/email-code-login',
    { body: { email, language } },
    { isPublicAPI: true },
  )

export const webAppEmailLoginWithCode = (data: {
  email: string
  code: string
  token: string
}): Promise<LoginResponse> =>
  post<LoginResponse>('/email-code-login/validity', { body: data }, { isPublicAPI: true })

export const sendWebAppResetPasswordCode = (
  email: string,
  language = 'en-US',
): Promise<CommonResponse & { data: string; message?: string; code?: string }> =>
  post<CommonResponse & { data: string; message?: string; code?: string }>(
    '/forgot-password',
    { body: { email, language } },
    { isPublicAPI: true },
  )

export const verifyWebAppResetPasswordCode = (body: {
  email: string
  code: string
  token: string
}): Promise<CommonResponse & { is_valid: boolean; token: string }> =>
  post<CommonResponse & { is_valid: boolean; token: string }>(
    '/forgot-password/validity',
    { body },
    { isPublicAPI: true },
  )

export const getAvatar = async ({
  avatar,
}: {
  avatar: string
}): Promise<{ avatar_url: string }> => {
  const { consoleClient } = await import('@/service/console')
  return consoleClient.account.avatar.get({ query: { avatar } })
}
