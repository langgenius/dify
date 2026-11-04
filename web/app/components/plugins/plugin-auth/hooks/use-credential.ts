import type { CredentialTypeEnum, PluginPayload } from '../types'
import { useQueryClient } from '@tanstack/react-query'
import { getToolListQueryKey } from '@/app/components/tools/utils/tool-list-query-key'
import {
  useAddPluginCredential,
  useDeletePluginCredential,
  useDeletePluginOAuthCustomClient,
  useGetPluginCredentialInfo,
  useGetPluginCredentialSchema,
  useGetPluginOAuthClientSchema,
  useGetPluginOAuthUrl,
  useInvalidPluginCredentialInfo,
  useInvalidPluginOAuthClientSchema,
  useSetPluginDefaultCredential,
  useSetPluginOAuthCustomClient,
  useUpdatePluginCredential,
} from '@/service/use-plugins-auth'
import { getApi } from './get-api'

export const useGetPluginCredentialInfoHook = (
  pluginPayload: PluginPayload,
  enable?: boolean,
  includeCredentialIds?: string[],
) => {
  const apiMap = getApi(pluginPayload)
  const ids = (includeCredentialIds ?? []).filter(Boolean)
  let url = enable ? apiMap.getCredentialInfo : ''
  if (url && ids.length > 0) {
    const qs = new URLSearchParams()
    for (const id of ids) qs.append('include_credential_ids', id)
    url = url + (url.includes('?') ? '&' : '?') + qs.toString()
  }
  return useGetPluginCredentialInfo(url)
}

export const useDeletePluginCredentialHook = (pluginPayload: PluginPayload) => {
  return useDeletePluginCredential(pluginPayload)
}

export const useInvalidPluginCredentialInfoHook = (pluginPayload: PluginPayload) => {
  const apiMap = getApi(pluginPayload)
  const invalidPluginCredentialInfo = useInvalidPluginCredentialInfo(apiMap.getCredentialInfo)
  const queryClient = useQueryClient()
  const toolListQueryKey = getToolListQueryKey(pluginPayload.providerType)

  return () => {
    invalidPluginCredentialInfo()
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
  return useGetPluginCredentialSchema(pluginPayload, credentialType)
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
  return useGetPluginOAuthClientSchema(pluginPayload, enabled)
}

export const useInvalidPluginOAuthClientSchemaHook = (pluginPayload: PluginPayload) => {
  return useInvalidPluginOAuthClientSchema(pluginPayload)
}

export const useSetPluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  return useSetPluginOAuthCustomClient(pluginPayload)
}

export const useDeletePluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  return useDeletePluginOAuthCustomClient(pluginPayload)
}
