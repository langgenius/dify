import {
  del,
  get,
  post,
} from './base'
import type {
  ModelItem,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useMutation,
  useQuery,
  // useQueryClient,
} from '@tanstack/react-query'

const NAME_SPACE = 'models'

export const useModelProviderModelList = (provider: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-list', provider],
    queryFn: () => get<{ data: ModelItem[] }>(`/workspaces/current/model-providers/${provider}/models`),
  })
}

export const useAddModelCredential = (providerName: string) => {
  return useMutation({
    mutationFn: (data: any) => post<{ result: string }>(`/workspaces/current/model-providers/${providerName}/credentials`, data),
  })
}

export const useGetModelCredential = (providerName: string, credentialId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-credential', providerName, credentialId],
    queryFn: () => get<{ data: Credential[] }>(`/workspaces/current/model-providers/${providerName}/credentials?credential_id=${credentialId}`),
  })
}

export const useDeleteModelCredential = (providerName: string) => {
  return useMutation({
    mutationFn: (credentialId: string) => del<{ result: string }>(`/workspaces/current/model-providers/${providerName}/credentials`, {
      body: {
        credential_id: credentialId,
      },
    }),
  })
}

export const useSetModelCredentialDefault = (providerName: string) => {
  return useMutation({
    mutationFn: (credentialId: string) => post<{ result: string }>(`/workspaces/current/model-providers/${providerName}/credentials/switch`, {
      body: {
        credential_id: credentialId,
      },
    }),
  })
}
