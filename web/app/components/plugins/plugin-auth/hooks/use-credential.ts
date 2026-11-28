import type { CredentialTypeEnum, PluginPayload } from '../types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getToolListQueryKey } from '@/app/components/tools/utils/tool-list-query-key'
import { consoleQuery } from '@/service/console'
import {
  pluginCredentialInfoQueryOptions,
  pluginCredentialSchemaQueryOptions,
  pluginOAuthClientSchemaQueryOptions,
} from '@/service/plugin-credential-queries'
import {
  useAddPluginCredential,
  useDeletePluginCredential,
  useDeletePluginOAuthCustomClient,
  useGetPluginOAuthUrl,
  useSetPluginDefaultCredential,
  useSetPluginOAuthCustomClient,
  useUpdatePluginCredential,
} from '@/service/use-plugins-auth'
import { AuthCategory } from '../types'

export const useGetPluginCredentialInfoHook = (
  pluginPayload: PluginPayload,
  enable?: boolean,
  includeCredentialIds?: string[],
) => {
  return useQuery(
    pluginCredentialInfoQueryOptions(pluginPayload, {
      enabled: !!enable,
      includeCredentialIds: (includeCredentialIds ?? []).filter(Boolean),
    }),
  )
}

export const useDeletePluginCredentialHook = (pluginPayload: PluginPayload) => {
  return useDeletePluginCredential(pluginPayload)
}

export const useInvalidPluginCredentialInfoHook = (pluginPayload: PluginPayload) => {
  const { category = AuthCategory.tool, provider, providerType } = pluginPayload
  const queryClient = useQueryClient()
  const toolListQueryKey = getToolListQueryKey(providerType)

  return () => {
    if (category === AuthCategory.tool) {
      queryClient.invalidateQueries({
        queryKey:
          consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key({
            input: { params: { provider } },
          }),
      })
    }
    if (toolListQueryKey) queryClient.invalidateQueries({ queryKey: toolListQueryKey })
  }
}

export const useSetPluginDefaultCredentialHook = (pluginPayload: PluginPayload) => {
  return useSetPluginDefaultCredential(pluginPayload)
}

export const useGetPluginCredentialSchemaHook = (
  pluginPayload: PluginPayload,
  credentialType: CredentialTypeEnum,
) => {
  return useQuery(pluginCredentialSchemaQueryOptions(pluginPayload, credentialType))
}

export const useAddPluginCredentialHook = (pluginPayload: PluginPayload) => {
  return useAddPluginCredential(pluginPayload)
}

export const useUpdatePluginCredentialHook = (pluginPayload: PluginPayload) => {
  return useUpdatePluginCredential(pluginPayload)
}

export const useGetPluginOAuthUrlHook = (pluginPayload: PluginPayload) => {
  return useGetPluginOAuthUrl(pluginPayload)
}

export const useGetPluginOAuthClientSchemaHook = (pluginPayload: PluginPayload, enabled = true) => {
  return useQuery(pluginOAuthClientSchemaQueryOptions(pluginPayload, enabled))
}

export const useSetPluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  return useSetPluginOAuthCustomClient(pluginPayload)
}

export const useDeletePluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  return useDeletePluginOAuthCustomClient(pluginPayload)
}
