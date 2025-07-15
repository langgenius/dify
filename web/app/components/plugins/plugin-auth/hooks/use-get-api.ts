import {
  AuthCategory,
} from '../types'
import type {
  CredentialTypeEnum,
  PluginPayload,
} from '../types'

export const useGetApi = ({ category = AuthCategory.tool, provider }: PluginPayload) => {
  if (category === AuthCategory.tool) {
    return {
      getCredentialInfo: `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
      setDefaultCredential: `/workspaces/current/tool-provider/builtin/${provider}/default-credential`,
      getCredentials: `/workspaces/current/tool-provider/builtin/${provider}/credentials`,
      addCredential: `/workspaces/current/tool-provider/builtin/${provider}/add`,
      updateCredential: `/workspaces/current/tool-provider/builtin/${provider}/update`,
      deleteCredential: `/workspaces/current/tool-provider/builtin/${provider}/delete`,
      getCredentialSchema: (credential_type: CredentialTypeEnum) => `/workspaces/current/tool-provider/builtin/${provider}/credential/schema/${credential_type}`,
      getOauthUrl: `/oauth/plugin/${provider}/tool/authorization-url`,
      getOauthClientSchema: `/workspaces/current/tool-provider/builtin/${provider}/oauth/client-schema`,
      setCustomOauthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      getCustomOAuthClientValues: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      deleteCustomOAuthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
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
