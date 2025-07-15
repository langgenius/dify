import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { del, get, post } from './base'
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
      credentials?: Record<string, any>
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
  return useMutation({
    mutationKey: [NAME_SPACE, 'oauth-url', url],
    mutationFn: () => {
      return get<
      {
        authorization_url: string
        state: string
        context_id: string
      }>(url)
    },
  })
}

export const useGetPluginOAuthClientSchema = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'oauth-client-schema', url],
    queryFn: () => get<{
      schema: FormSchema[]
      is_oauth_custom_client_enabled: boolean
      is_system_oauth_params_exists?: boolean
      client_params?: Record<string, any>
      redirect_uri?: string
    }>(url),
    staleTime: 0,
  })
}

export const useInvalidPluginOAuthClientSchema = (
  url: string,
) => {
  return useInvalid([NAME_SPACE, 'oauth-client-schema', url])
}

export const useSetPluginOAuthCustomClient = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params: {
        client_params: Record<string, any>
        enable_oauth_custom_client: boolean
      }) => {
      return post<{ result: string }>(url, { body: params })
    },
  })
}

export const useDeletePluginOAuthCustomClient = (
  url: string,
) => {
  return useMutation({
    mutationFn: () => {
      return del<{ result: string }>(url)
    },
  })
}
