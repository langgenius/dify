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

export const useGetPluginToolCredentialInfo = (
  provider: string,
) => {
  return useQuery({
    enabled: !!provider,
    queryKey: [NAME_SPACE, 'credential-info', provider],
    queryFn: () => get<{
        supported_credential_types: string[]
        credentials: Credential[]
        is_oauth_custom_client_enabled: boolean
      }>(`/workspaces/current/tool-provider/builtin/${provider}/credential/info`),
    staleTime: 0,
  })
}

export const useInvalidPluginToolCredentialInfo = (
  provider: string,
) => {
  return useInvalid([NAME_SPACE, 'credential-info', provider])
}

export const useSetPluginToolDefaultCredential = (
  provider: string,
) => {
  return useMutation({
    mutationFn: (id: string) => {
      return post(`/workspaces/current/tool-provider/builtin/${provider}/default-credential`, { body: { id } })
    },
  })
}

export const useGetPluginToolCredentialList = (
  provider: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'credential-list', provider],
    queryFn: () => get(`/workspaces/current/tool-provider/builtin/${provider}/credentials`),
  })
}

export const useAddPluginToolCredential = (
  provider: string,
) => {
  return useMutation({
    mutationFn: (params: {
      credentials: Record<string, any>
      type: CredentialTypeEnum
      name?: string
    }) => {
      return post(`/workspaces/current/tool-provider/builtin/${provider}/add`, { body: params })
    },
  })
}

export const useUpdatePluginToolCredential = (
  provider: string,
) => {
  return useMutation({
    mutationFn: (params: {
      credential_id: string
      credentials: Record<string, any>
      type: CredentialTypeEnum
      name?: string
    }) => {
      return post(`/workspaces/current/tool-provider/builtin/${provider}/update`, { body: params })
    },
  })
}

export const useDeletePluginToolCredential = (
  provider: string,
) => {
  return useMutation({
    mutationFn: (params: { credential_id: string }) => {
      return post(`/workspaces/current/tool-provider/builtin/${provider}/delete`, { body: params })
    },
  })
}

export const useGetPluginToolCredentialSchema = (
  provider: string,
  credential_type: CredentialTypeEnum,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'credential-schema', provider, credential_type],
    queryFn: () => get<FormSchema[]>(`/workspaces/current/tool-provider/builtin/${provider}/credential/schema/${credential_type}`),
  })
}

export const useGetPluginToolOAuthUrl = (
  provider: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-url', provider],
    queryFn: () => get(`oauth/plugin/${provider}/tool/authorization-url`),
  })
}

export const useGetPluginToolOAuthClientSchema = (
  provider: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-client-schema', provider],
    queryFn: () => get(`/workspaces/current/tool-provider/builtin/${provider}/oauth/client-schema`),
  })
}

export const useSetPluginToolOAuthCustomClient = (
  provider: string,
) => {
  return useMutation({
    mutationFn: (params) => {
      return post(`/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`, { body: params })
    },
  })
}

export const useGetPluginToolOAuthCustomClientSchema = (
  provider: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-custom-client-schema', provider],
    queryFn: () => get(`/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`),
  })
}
