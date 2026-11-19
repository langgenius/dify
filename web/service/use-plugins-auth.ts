import type { GetOauthPluginByProviderToolAuthorizationUrlData } from '@dify/contracts/api/console/oauth/types.gen'
import type {
  BuiltinToolAddPayload,
  BuiltinToolCredentialDeletePayload,
  BuiltinToolUpdatePayload,
  ToolOAuthCustomClientPayload,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  Credential,
  CredentialTypeEnum,
  PluginPayload,
} from '@/app/components/plugins/plugin-auth/types'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import { get } from './base'
import { consoleQuery } from './console'
import { selectCredentialFormSchema } from './console/plugin-auth-select'
import { useInvalid } from './use-base'

const NAME_SPACE = 'plugins-auth'

export const useGetPluginCredentialInfo = (url: string) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'credential-info', url],
    queryFn: () =>
      get<{
        allow_custom_token?: boolean
        supported_credential_types: string[]
        credentials: Credential[]
        is_oauth_custom_client_enabled: boolean
      }>(url),
    staleTime: 0,
  })
}

export const useInvalidPluginCredentialInfo = (url: string) => {
  return useInvalid([NAME_SPACE, 'credential-info', url])
}

export const useSetPluginDefaultCredential = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: setToolDefault } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.defaultCredential.post.mutationOptions(),
  )
  const { mutateAsync: setDatasourceDefault } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.default.post.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (id: string) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return setToolDefault({ params: { provider }, body: { id } })
        case AuthCategory.datasource:
          return setDatasourceDefault({ params: { provider_id: provider }, body: { id } })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, setToolDefault, setDatasourceDefault],
  )
  return { mutateAsync }
}

export const useAddPluginCredential = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: addToolCredential } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.add.post.mutationOptions(),
  )
  const { mutateAsync: addDatasourceCredential } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.post.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (body: BuiltinToolAddPayload) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return addToolCredential({ params: { provider }, body })
        case AuthCategory.datasource:
          return addDatasourceCredential({
            params: { provider_id: provider },
            body: { credentials: body.credentials, name: body.name },
          })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, addToolCredential, addDatasourceCredential],
  )
  return { mutateAsync }
}

export const useUpdatePluginCredential = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: updateToolCredential } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.update.post.mutationOptions(),
  )
  const { mutateAsync: updateDatasourceCredential } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.update.post.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (body: BuiltinToolUpdatePayload) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return updateToolCredential({ params: { provider }, body })
        case AuthCategory.datasource:
          return updateDatasourceCredential({ params: { provider_id: provider }, body })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, updateToolCredential, updateDatasourceCredential],
  )
  return { mutateAsync }
}

export const useDeletePluginCredential = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: deleteToolCredential } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.delete.post.mutationOptions(),
  )
  const { mutateAsync: deleteDatasourceCredential } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.delete.post.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (body: BuiltinToolCredentialDeletePayload) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return deleteToolCredential({ params: { provider }, body })
        case AuthCategory.datasource:
          return deleteDatasourceCredential({ params: { provider_id: provider }, body })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, deleteToolCredential, deleteDatasourceCredential],
  )
  return { mutateAsync }
}

export const useGetPluginCredentialSchema = (
  { category, provider }: PluginPayload,
  credentialType: CredentialTypeEnum,
) => {
  return useQuery(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryOptions(
      {
        input:
          category === AuthCategory.tool && provider
            ? { params: { provider, credential_type: credentialType } }
            : skipToken,
        select: (schema) => schema.map(selectCredentialFormSchema),
      },
    ),
  )
}

export const useGetPluginOAuthUrl = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: getToolUrl, isPending: isToolPending } = useMutation(
    consoleQuery.oauth.plugin.byProvider.tool.authorizationUrl.get.mutationOptions(),
  )
  const { mutateAsync: getDatasourceUrl, isPending: isDatasourcePending } = useMutation(
    consoleQuery.oauth.plugin.byProviderId.datasource.getAuthorizationUrl.get.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (query?: GetOauthPluginByProviderToolAuthorizationUrlData['query']) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return getToolUrl({ params: { provider }, query })
        case AuthCategory.datasource:
          return getDatasourceUrl({ params: { provider_id: provider }, query })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, getToolUrl, getDatasourceUrl],
  )
  return { mutateAsync, isPending: isToolPending || isDatasourcePending }
}

export const useGetPluginOAuthClientSchema = (
  { category, provider }: PluginPayload,
  enabled = true,
) => {
  return useQuery(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.queryOptions(
      {
        input:
          enabled && category === AuthCategory.tool && provider
            ? { params: { provider } }
            : skipToken,
        select: (data) => ({
          ...data,
          client_params: data.client_params ?? undefined,
          schema: data.schema.map(selectCredentialFormSchema),
        }),
        staleTime: 0,
      },
    ),
  )
}

export const useInvalidPluginOAuthClientSchema = ({ category, provider }: PluginPayload) => {
  const queryClient = useQueryClient()
  return useCallback(() => {
    if (category !== AuthCategory.tool || !provider) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey:
        consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key({
          input: { params: { provider } },
        }),
    })
  }, [queryClient, category, provider])
}

export const useSetPluginOAuthCustomClient = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: setToolClient } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.post.mutationOptions(),
  )
  const { mutateAsync: setDatasourceClient } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.customClient.post.mutationOptions(),
  )
  const mutateAsync = useCallback(
    async (body: ToolOAuthCustomClientPayload) => {
      if (!provider) throw new Error('Credential provider is required')
      switch (category) {
        case AuthCategory.tool:
          return setToolClient({ params: { provider }, body })
        case AuthCategory.datasource:
          return setDatasourceClient({ params: { provider_id: provider }, body })
        default:
          throw new Error(`Unsupported credential category: ${category}`)
      }
    },
    [category, provider, setToolClient, setDatasourceClient],
  )
  return { mutateAsync }
}

export const useDeletePluginOAuthCustomClient = ({ category, provider }: PluginPayload) => {
  const { mutateAsync: deleteToolClient } = useMutation(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.delete.mutationOptions(),
  )
  const { mutateAsync: deleteDatasourceClient } = useMutation(
    consoleQuery.auth.plugin.datasource.byProviderId.customClient.delete.mutationOptions(),
  )
  const mutateAsync = useCallback(async () => {
    if (!provider) throw new Error('Credential provider is required')
    switch (category) {
      case AuthCategory.tool:
        return deleteToolClient({ params: { provider } })
      case AuthCategory.datasource:
        return deleteDatasourceClient({ params: { provider_id: provider } })
      default:
        throw new Error(`Unsupported credential category: ${category}`)
    }
  }, [category, provider, deleteToolClient, deleteDatasourceClient])
  return { mutateAsync }
}
