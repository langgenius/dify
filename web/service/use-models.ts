import type {
  ModelCredential,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelTypeEnum,
  ProviderCredential,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useMutation,
  useQuery,
  // useQueryClient,
} from '@tanstack/react-query'
import {
  del,
  get,
  post,
  put,
} from './base'

const NAME_SPACE = 'models'

export const useModelProviderModelList = (provider: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-list', provider],
    queryFn: () => get<{ data: ModelItem[] }>(`/workspaces/current/model-providers/${provider}/models`),
  })
}

export const useGetProviderCredential = (enabled: boolean, provider: string, credentialId?: string) => {
  return useQuery({
    enabled,
    queryKey: [NAME_SPACE, 'model-list', provider, credentialId],
    queryFn: () => get<ProviderCredential>(`/workspaces/current/model-providers/${provider}/credentials${credentialId ? `?credential_id=${credentialId}` : ''}`),
  })
}

export const useAddProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ProviderCredential) => post<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
      body: data,
    }),
  })
}

export const useEditProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ProviderCredential) => put<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
      body: data,
    }),
  })
}

export const useDeleteProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
    }) => del<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
      body: data,
    }),
  })
}

export const useActiveProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => post<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials/switch`, {
      body: data,
    }),
  })
}

export const useGetModelCredential = (
  enabled: boolean,
  provider: string,
  credentialId?: string,
  model?: string,
  modelType?: string,
  configFrom?: string,
) => {
  return useQuery({
    enabled,
    queryKey: [NAME_SPACE, 'model-list', provider, model, modelType, credentialId, configFrom],
    queryFn: () => get<ModelCredential>(`/workspaces/current/model-providers/${provider}/models/credentials?model=${model}&model_type=${modelType}&config_from=${configFrom}${credentialId ? `&credential_id=${credentialId}` : ''}`),
    staleTime: 0,
    gcTime: 0,
  })
}

export const useAddModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ModelCredential) => post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
      body: data,
    }),
  })
}

export const useEditModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ModelCredential) => put<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
      body: data,
    }),
  })
}

export const useDeleteModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => del<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
      body: data,
    }),
  })
}

export const useDeleteModel = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      model: string
      model_type: ModelTypeEnum
    }) => del<{ result: string }>(`/workspaces/current/model-providers/${provider}/models`, {
      body: data,
    }),
  })
}

export const useActiveModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials/switch`, {
      body: data,
    }),
  })
}

export const useUpdateModelLoadBalancingConfig = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      config_from: string
      model: string
      model_type: ModelTypeEnum
      load_balancing: ModelLoadBalancingConfig
      credential_id?: string
    }) => post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models`, {
      body: data,
    }),
  })
}
