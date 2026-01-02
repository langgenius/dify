import type {
  ModelCredential,
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
  activateModelCredential,
  activateProviderCredential,
  addModelCredential,
  addProviderCredential,
  deleteModel,
  deleteModelCredential,
  deleteProviderCredential,
  editModelCredential,
  editProviderCredential,
  fetchModelCredential,
  fetchModelProviderModelList,
  fetchProviderCredential,
  updateModelLoadBalancingConfig,
} from './models'

const NAME_SPACE = 'models'

export const useModelProviderModelList = (provider: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-list', provider],
    queryFn: () => fetchModelProviderModelList(provider),
  })
}

export const useGetProviderCredential = (enabled: boolean, provider: string, credentialId?: string) => {
  return useQuery({
    enabled,
    queryKey: [NAME_SPACE, 'model-list', provider, credentialId],
    queryFn: () => fetchProviderCredential(provider, credentialId),
  })
}

export const useAddProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ProviderCredential) => addProviderCredential(provider, data),
  })
}

export const useEditProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ProviderCredential) => editProviderCredential(provider, data),
  })
}

export const useDeleteProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
    }) => deleteProviderCredential(provider, data),
  })
}

export const useActiveProviderCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => activateProviderCredential(provider, data),
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
    queryKey: [NAME_SPACE, 'model-list', provider, model, modelType, credentialId],
    queryFn: () => fetchModelCredential(provider, model, modelType, configFrom, credentialId),
    staleTime: 0,
    gcTime: 0,
  })
}

export const useAddModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ModelCredential) => addModelCredential(provider, data),
  })
}

export const useEditModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: ModelCredential) => editModelCredential(provider, data),
  })
}

export const useDeleteModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => deleteModelCredential(provider, data),
  })
}

export const useDeleteModel = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      model: string
      model_type: ModelTypeEnum
    }) => deleteModel(provider, data),
  })
}

export const useActiveModelCredential = (provider: string) => {
  return useMutation({
    mutationFn: (data: {
      credential_id: string
      model?: string
      model_type?: ModelTypeEnum
    }) => activateModelCredential(provider, data),
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
    }) => updateModelLoadBalancingConfig(provider, data),
  })
}
