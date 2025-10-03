import { useAppContext } from '@/context/app-context'
import {
  useGetPluginCredentialInfoHook,
  useInvalidPluginCredentialInfoHook,
} from './use-credential'
import { CredentialTypeEnum } from '../types'
import type { PluginPayload } from '../types'

export const usePluginAuth = (pluginPayload: PluginPayload, enable?: boolean) => {
  const { data } = useGetPluginCredentialInfoHook(pluginPayload, enable)
  const { isCurrentWorkspaceManager } = useAppContext()
  const isAuthorized = !!data?.credentials.length
  const canOAuth = data?.supported_credential_types.includes(CredentialTypeEnum.OAUTH2)
  const canApiKey = data?.supported_credential_types.includes(CredentialTypeEnum.API_KEY)
  const invalidPluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)

  return {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials: data?.credentials || [],
    disabled: !isCurrentWorkspaceManager,
    notAllowCustomCredential: data?.allow_custom_token === false,
    invalidPluginCredentialInfo,
  }
}
