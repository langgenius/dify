import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { get, post } from './base'
import { useInvalid } from './use-base'
import type {
  Credential,
  CredentialTypeEnum,
} from '@/app/components/plugins/plugin-auth/types'
import type { FormSchema } from '@/app/components/base/form/types'

const NAME_SPACE = 'plugins-auth'

export const useGetPluginCredentialInfo = (
  url: string,
) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'credential-info', url],
    queryFn: () => get<{
        supported_credential_types: string[]
        credentials: Credential[]
        is_oauth_custom_client_enabled: boolean
      }>(url),
    staleTime: 0,
  })
}

export const useInvalidPluginCredentialInfo = (
  url: string,
) => {
  return useInvalid([NAME_SPACE, 'credential-info', url])
}

export const useSetPluginDefaultCredential = (
  url: string,
) => {
  return useMutation({
    mutationFn: (id: string) => {
      return post(url, { body: { id } })
    },
  })
}

export const useGetPluginCredentialList = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'credential-list', url],
    queryFn: () => get(url),
  })
}

export const useAddPluginCredential = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params: {
      credentials: Record<string, any>
      type: CredentialTypeEnum
      name?: string
    }) => {
      return post(url, { body: params })
    },
  })
}

export const useUpdatePluginCredential = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params: {
      credential_id: string
      credentials: Record<string, any>
      type: CredentialTypeEnum
      name?: string
    }) => {
      return post(url, { body: params })
    },
  })
}

export const useDeletePluginCredential = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params: { credential_id: string }) => {
      return post(url, { body: params })
    },
  })
}

export const useGetPluginCredentialSchema = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'credential-schema', url],
    queryFn: () => get<FormSchema[]>(url),
  })
}

export const useGetPluginOAuthUrl = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-url', url],
    queryFn: () => get(url),
  })
}

export const useGetPluginOAuthClientSchema = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-client-schema', url],
    queryFn: () => get(url),
  })
}

export const useSetPluginOAuthCustomClient = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params) => {
      return post(url, { body: params })
    },
  })
}

export const useGetPluginOAuthCustomClientSchema = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-custom-client-schema', url],
    queryFn: () => get(url),
  })
}
