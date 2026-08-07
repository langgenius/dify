import type { CredentialTypeEnum, PluginPayload } from '../types'
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
import { useInvalidToolsByType } from '@/service/use-tools'
import { useGetApi } from './use-get-api'

export const useGetPluginCredentialInfoHook = (
  pluginPayload: PluginPayload,
  enable?: boolean,
  includeCredentialIds?: string[],
) => {
  const apiMap = useGetApi(pluginPayload)
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
  const apiMap = useGetApi(pluginPayload)

  return useDeletePluginCredential(apiMap.deleteCredential)
}

export const useInvalidPluginCredentialInfoHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)
  const invalidPluginCredentialInfo = useInvalidPluginCredentialInfo(apiMap.getCredentialInfo)
  const providerType = pluginPayload.providerType
  const invalidToolsByType = useInvalidToolsByType(providerType)

  return () => {
    invalidPluginCredentialInfo()
    invalidToolsByType()
  }
}

export const useSetPluginDefaultCredentialHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useSetPluginDefaultCredential(apiMap.setDefaultCredential)
}

export const useGetPluginCredentialSchemaHook = (
  pluginPayload: PluginPayload,
  credentialType: CredentialTypeEnum,
) => {
  const apiMap = useGetApi(pluginPayload)

  return useGetPluginCredentialSchema(apiMap.getCredentialSchema(credentialType))
}

export const useAddPluginCredentialHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useAddPluginCredential(apiMap.addCredential)
}

export const useUpdatePluginCredentialHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useUpdatePluginCredential(apiMap.updateCredential)
}

export const useGetPluginOAuthUrlHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useGetPluginOAuthUrl(apiMap.getOauthUrl)
}

export const useGetPluginOAuthClientSchemaHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useGetPluginOAuthClientSchema(apiMap.getOauthClientSchema)
}

export const useInvalidPluginOAuthClientSchemaHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useInvalidPluginOAuthClientSchema(apiMap.getOauthClientSchema)
}

export const useSetPluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useSetPluginOAuthCustomClient(apiMap.setCustomOauthClient)
}

export const useDeletePluginOAuthCustomClientHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useDeletePluginOAuthCustomClient(apiMap.deleteCustomOAuthClient)
}
