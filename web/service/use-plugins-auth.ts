import type {
  CredentialTypeEnum,
} from '@/app/components/plugins/plugin-auth/types'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import {
  addPluginCredential,
  deletePluginCredential,
  deletePluginOAuthCustomClient,
  fetchPluginCredentialInfo,
  fetchPluginCredentialList,
  fetchPluginCredentialSchema,
  fetchPluginOAuthClientSchema,
  fetchPluginOAuthUrl,
  setPluginDefaultCredential,
  setPluginOAuthCustomClient,
  updatePluginCredential,
} from './plugins-auth'
import { useInvalid } from './use-base'

const NAME_SPACE = 'plugins-auth'

export const useGetPluginCredentialInfo = (
  url: string,
) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'credential-info', url],
    queryFn: () => fetchPluginCredentialInfo(url),
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
      return setPluginDefaultCredential(url, id)
    },
  })
}

export const useGetPluginCredentialList = (
  url: string,
) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'credential-list', url],
    queryFn: () => fetchPluginCredentialList(url),
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
      return addPluginCredential(url, params)
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
      return updatePluginCredential(url, params)
    },
  })
}

export const useDeletePluginCredential = (
  url: string,
) => {
  return useMutation({
    mutationFn: (params: { credential_id: string }) => {
      return deletePluginCredential(url, params)
    },
  })
}

export const useGetPluginCredentialSchema = (
  url: string,
) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'credential-schema', url],
    queryFn: () => fetchPluginCredentialSchema(url),
  })
}

export const useGetPluginOAuthUrl = (
  url: string,
) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'oauth-url', url],
    mutationFn: () => {
      return fetchPluginOAuthUrl(url)
    },
  })
}

export const useGetPluginOAuthClientSchema = (
  url: string,
) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'oauth-client-schema', url],
    queryFn: () => fetchPluginOAuthClientSchema(url),
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
      return setPluginOAuthCustomClient(url, params)
    },
  })
}

export const useDeletePluginOAuthCustomClient = (
  url: string,
) => {
  return useMutation({
    mutationFn: () => {
      return deletePluginOAuthCustomClient(url)
    },
  })
}
