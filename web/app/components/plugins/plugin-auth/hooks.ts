import { useAppContext } from '@/context/app-context'
import { useGetPluginToolCredentialInfo } from '@/service/use-plugins-auth'
import { CredentialTypeEnum } from './types'

export const usePluginAuth = (provider: string, enable?: boolean) => {
  const { data } = useGetPluginToolCredentialInfo(enable ? provider : '')
  const { isCurrentWorkspaceManager } = useAppContext()
  const isAuthorized = !!data?.credentials.length
  const canOAuth = data?.supported_credential_types.includes(CredentialTypeEnum.OAUTH2)
  const canApiKey = data?.supported_credential_types.includes(CredentialTypeEnum.API_KEY)

  return {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials: data?.credentials || [],
    provider,
    disabled: !isCurrentWorkspaceManager,
  }
}
