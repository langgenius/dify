import { post } from './base'

export type OAuthAppInfo = {
  app_icon: string
  app_label: Record<string, string>
  scope: string
}

export type OAuthAuthorizeResponse = {
  code: string
}

export const fetchOAuthAppInfo = (client_id: string, redirect_uri: string) => {
  return post<OAuthAppInfo>('/oauth/provider', { body: { client_id, redirect_uri } }, { silent: true })
}

export const authorizeOAuthApp = (payload: { client_id: string }) => {
  return post<OAuthAuthorizeResponse>('/oauth/provider/authorize', { body: payload })
}
