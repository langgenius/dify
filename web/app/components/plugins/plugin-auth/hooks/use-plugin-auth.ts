import type { PluginPayload } from '../types'
import { CredentialTypeEnum } from '../types'
import {
  useGetPluginCredentialInfoHook,
  useInvalidPluginCredentialInfoHook,
} from './use-credential'

export const usePluginAuth = (
  pluginPayload: PluginPayload,
  enable?: boolean,
  includeCredentialIds?: string[],
) => {
  const { data } = useGetPluginCredentialInfoHook(pluginPayload, enable, includeCredentialIds)
  const isAuthorized = !!data?.credentials.length
  const canOAuth = data?.supported_credential_types.includes(CredentialTypeEnum.OAUTH2)
  const canApiKey = data?.supported_credential_types.includes(CredentialTypeEnum.API_KEY)
  const invalidPluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)

  return {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials: data?.credentials || [],
    notAllowCustomCredential: data?.allow_custom_token === false,
    invalidPluginCredentialInfo,
  }
}
