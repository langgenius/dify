import type {
  CustomModel,
  ModelCredentialPayload,
  ModelTypeEnum,
  ProviderCredential,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleClient, consoleQuery } from '@/service/console'

type ModelCredentialRef = { credential_id: string; model: string; model_type: ModelTypeEnum }

export const useGetCredential = (
  provider: string,
  isModelCredential?: boolean,
  credentialId?: string,
  model?: CustomModel,
  configFrom?: string,
) => {
  const modelProvider = consoleQuery.workspaces.current.modelProviders.byProvider
  const providerData = useQuery({
    ...modelProvider.credentials.get.queryOptions({
      input:
        !isModelCredential && credentialId
          ? { params: { provider }, query: { credential_id: credentialId } }
          : skipToken,
    }),
    staleTime: 0,
    gcTime: 0,
  })
  const modelData = useQuery({
    ...modelProvider.models.credentials.get.queryOptions({
      input:
        isModelCredential && model
          ? {
              params: { provider },
              query: {
                model: model.model,
                model_type: model.model_type,
                config_from: configFrom,
                credential_id: credentialId,
              },
            }
          : skipToken,
    }),
    staleTime: 0,
    gcTime: 0,
  })
  return isModelCredential ? modelData : providerData
}

export const useAuthService = (provider: string) => {
  const client = consoleClient.workspaces.current.modelProviders.byProvider
  const params = { provider }

  const { mutateAsync: addProviderCredential } = useMutation({
    mutationFn: (body: ProviderCredential) => client.credentials.post({ params, body }),
  })
  const { mutateAsync: editProviderCredential } = useMutation({
    mutationFn: (body: ProviderCredential) => client.credentials.put({ params, body }),
  })
  const { mutateAsync: deleteProviderCredential } = useMutation({
    mutationFn: (body: { credential_id: string }) => client.credentials.delete({ params, body }),
  })
  const { mutateAsync: activeProviderCredential } = useMutation({
    mutationFn: (body: { credential_id: string }) =>
      client.credentials.switch.post({ params, body }),
  })

  const { mutateAsync: addModelCredential } = useMutation({
    mutationFn: (body: ModelCredentialPayload) => client.models.credentials.post({ params, body }),
  })
  const { mutateAsync: activeModelCredential } = useMutation({
    mutationFn: (body: ModelCredentialRef) =>
      client.models.credentials.switch.post({ params, body }),
  })
  const { mutateAsync: deleteModelCredential } = useMutation({
    mutationFn: (query: ModelCredentialRef) => client.models.credentials.delete({ params, query }),
  })
  const { mutateAsync: editModelCredential } = useMutation({
    mutationFn: (body: ModelCredentialPayload & { credential_id: string }) =>
      client.models.credentials.put({ params, body }),
  })

  const getAddCredentialService = useCallback(
    (isModel: boolean) => {
      return isModel ? addModelCredential : addProviderCredential
    },
    [addModelCredential, addProviderCredential],
  )

  const getEditCredentialService = useCallback(
    (isModel: boolean) => {
      return isModel ? editModelCredential : editProviderCredential
    },
    [editModelCredential, editProviderCredential],
  )

  const getDeleteCredentialService = useCallback(
    (isModel: boolean) => {
      return isModel ? deleteModelCredential : deleteProviderCredential
    },
    [deleteModelCredential, deleteProviderCredential],
  )

  const getActiveCredentialService = useCallback(
    (isModel: boolean) => {
      return isModel ? activeModelCredential : activeProviderCredential
    },
    [activeModelCredential, activeProviderCredential],
  )

  return {
    getAddCredentialService,
    getEditCredentialService,
    getDeleteCredentialService,
    getActiveCredentialService,
  }
}
