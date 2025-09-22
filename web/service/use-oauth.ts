import { post } from './base'
import { useMutation, useQuery } from '@tanstack/react-query'

const NAME_SPACE = 'oauth-provider'

export type OAuthAppInfo = {
  app_icon: string
  app_label: Record<string, string>
  scope: string
}

export type OAuthAuthorizeResponse = {
  code: string
}

export const useOAuthAppInfo = (client_id: string, redirect_uri: string) => {
  return useQuery<OAuthAppInfo>({
    queryKey: [NAME_SPACE, 'authAppInfo', client_id, redirect_uri],
    queryFn: () => post<OAuthAppInfo>('/oauth/provider', { body: { client_id, redirect_uri } }, { silent: true }),
    enabled: Boolean(client_id && redirect_uri),
  })
}

export const useAuthorizeOAuthApp = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'authorize'],
    mutationFn: (payload: { client_id: string }) => post<OAuthAuthorizeResponse>('/oauth/provider/authorize', { body: payload }),
  })
}
