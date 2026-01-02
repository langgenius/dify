import type { OAuthAppInfo } from './oauth'
import { useMutation, useQuery } from '@tanstack/react-query'
import { authorizeOAuthApp, fetchOAuthAppInfo } from './oauth'

const NAME_SPACE = 'oauth-provider'

export const useOAuthAppInfo = (client_id: string, redirect_uri: string) => {
  return useQuery<OAuthAppInfo>({
    queryKey: [NAME_SPACE, 'authAppInfo', client_id, redirect_uri],
    queryFn: () => fetchOAuthAppInfo(client_id, redirect_uri),
    enabled: Boolean(client_id && redirect_uri),
  })
}

export const useAuthorizeOAuthApp = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'authorize'],
    mutationFn: (payload: { client_id: string }) => authorizeOAuthApp(payload),
  })
}
