import type {
  BuiltinProviderOAuthClientSchemaResponse,
  ProviderConfigListResponse,
  ToolProviderCredentialInfoApiEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  Credential,
  CredentialTypeEnum,
  PluginPayload,
} from '@/app/components/plugins/plugin-auth/types'
import { skipToken } from '@tanstack/react-query'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { consoleQuery } from '@/service/console'
import { selectCredentialFormSchema } from '@/service/console/plugin-auth-select'

type PluginCredentialInfo = Omit<ToolProviderCredentialInfoApiEntity, 'credentials'> & {
  credentials: Credential[]
  // Not part of the credential info response; plugin-auth still reads it.
  allow_custom_token?: boolean
}

// The credential list keeps the plugin-auth view model until its consumers adopt the contract type.
const selectPluginCredentialInfo = (info: ToolProviderCredentialInfoApiEntity) =>
  info as PluginCredentialInfo

// Only tool providers expose credential info; other categories keep the query idle.
export function pluginCredentialInfoQueryOptions(
  { category = AuthCategory.tool, provider }: PluginPayload,
  { enabled, includeCredentialIds }: { enabled: boolean; includeCredentialIds: string[] },
) {
  return consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.queryOptions(
    {
      input:
        enabled && category === AuthCategory.tool
          ? {
              params: { provider },
              ...(includeCredentialIds.length
                ? { query: { include_credential_ids: includeCredentialIds } }
                : {}),
            }
          : skipToken,
      select: selectPluginCredentialInfo,
    },
  )
}

const selectCredentialSchema = (schema: ProviderConfigListResponse) =>
  schema.map(selectCredentialFormSchema)

export function pluginCredentialSchemaQueryOptions(
  { category, provider }: PluginPayload,
  credentialType: CredentialTypeEnum,
) {
  return consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryOptions(
    {
      input:
        category === AuthCategory.tool && provider
          ? { params: { provider, credential_type: credentialType } }
          : skipToken,
      select: selectCredentialSchema,
    },
  )
}

const selectOAuthClientSchema = (data: BuiltinProviderOAuthClientSchemaResponse) => ({
  ...data,
  client_params: data.client_params ?? undefined,
  schema: data.schema.map(selectCredentialFormSchema),
})

export function pluginOAuthClientSchemaQueryOptions(
  { category, provider }: PluginPayload,
  enabled = true,
) {
  return consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.queryOptions(
    {
      input:
        enabled && category === AuthCategory.tool && provider
          ? { params: { provider } }
          : skipToken,
      select: selectOAuthClientSchema,
    },
  )
}
