import type { CredentialTypeEnum, PluginPayload } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import { AuthCategory } from '../types'

// These providers are identified by a UUID rather than a plugin id and have no credential
// endpoints, so the builtin routes 500 for them.
const TOOL_PROVIDER_TYPES_WITHOUT_CREDENTIALS: string[] = [
  CollectionType.custom,
  CollectionType.workflow,
  CollectionType.mcp,
]

export const useGetApi = ({
  category = AuthCategory.tool,
  provider,
  providerType,
}: PluginPayload) => {
  const usesBuiltInCredentialRoutes =
    providerType === undefined || !TOOL_PROVIDER_TYPES_WITHOUT_CREDENTIALS.includes(providerType)

  if (category === AuthCategory.tool && usesBuiltInCredentialRoutes) {
    return {
      getCredentialInfo: `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
      setDefaultCredential: `/workspaces/current/tool-provider/builtin/${provider}/default-credential`,
      getCredentials: `/workspaces/current/tool-provider/builtin/${provider}/credentials`,
      addCredential: `/workspaces/current/tool-provider/builtin/${provider}/add`,
      updateCredential: `/workspaces/current/tool-provider/builtin/${provider}/update`,
      deleteCredential: `/workspaces/current/tool-provider/builtin/${provider}/delete`,
      getCredentialSchema: (credential_type: CredentialTypeEnum) =>
        `/workspaces/current/tool-provider/builtin/${provider}/credential/schema/${credential_type}`,
      getOauthUrl: `/oauth/plugin/${provider}/tool/authorization-url`,
      getOauthClientSchema: `/workspaces/current/tool-provider/builtin/${provider}/oauth/client-schema`,
      setCustomOauthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      getCustomOAuthClientValues: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      deleteCustomOAuthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
    }
  }

  if (category === AuthCategory.datasource) {
    return {
      getCredentialInfo: '',
      setDefaultCredential: `/auth/plugin/datasource/${provider}/default`,
      getCredentials: `/auth/plugin/datasource/${provider}`,
      addCredential: `/auth/plugin/datasource/${provider}`,
      updateCredential: `/auth/plugin/datasource/${provider}/update`,
      deleteCredential: `/auth/plugin/datasource/${provider}/delete`,
      getCredentialSchema: () => '',
      getOauthUrl: `/oauth/plugin/${provider}/datasource/get-authorization-url`,
      getOauthClientSchema: '',
      setCustomOauthClient: `/auth/plugin/datasource/${provider}/custom-client`,
      deleteCustomOAuthClient: `/auth/plugin/datasource/${provider}/custom-client`,
    }
  }

  return {
    getCredentialInfo: '',
    setDefaultCredential: '',
    getCredentials: '',
    addCredential: '',
    updateCredential: '',
    deleteCredential: '',
    getCredentialSchema: () => '',
    getOauthUrl: '',
    getOauthClientSchema: '',
    setCustomOauthClient: '',
    getCustomOAuthClientValues: '',
    deleteCustomOAuthClient: '',
  }
}
