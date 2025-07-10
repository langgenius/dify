import {
  useAddPluginCredential,
  useDeletePluginCredential,
  useGetPluginCredentialInfo,
  useGetPluginCredentialSchema,
  useInvalidPluginCredentialInfo,
  useSetPluginDefaultCredential,
  useUpdatePluginCredential,
} from '@/service/use-plugins-auth'
import { useGetApi } from './use-get-api'
import type { PluginPayload } from '../types'
import type { CredentialTypeEnum } from '../types'

export const useGetPluginCredentialInfoHook = (pluginPayload: PluginPayload, enable?: boolean) => {
  const apiMap = useGetApi(pluginPayload)
  return useGetPluginCredentialInfo(enable ? apiMap.getCredentialInfo : '')
}

export const useDeletePluginCredentialHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useDeletePluginCredential(apiMap.deleteCredential)
}

export const useInvalidPluginCredentialInfoHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useInvalidPluginCredentialInfo(apiMap.getCredentialInfo)
}

export const useSetPluginDefaultCredentialHook = (pluginPayload: PluginPayload) => {
  const apiMap = useGetApi(pluginPayload)

  return useSetPluginDefaultCredential(apiMap.setDefaultCredential)
}

export const useGetPluginCredentialSchemaHook = (pluginPayload: PluginPayload, credentialType: CredentialTypeEnum) => {
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
