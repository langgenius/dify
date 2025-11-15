import { useCallback } from 'react'
import {
  useActiveModelCredential,
  useActiveProviderCredential,
  useAddModelCredential,
  useAddProviderCredential,
  useDeleteModelCredential,
  useDeleteProviderCredential,
  useEditModelCredential,
  useEditProviderCredential,
  useGetModelCredential,
  useGetProviderCredential,
} from '@/service/use-models'
import type {
  CustomModel,
} from '@/app/components/header/account-setting/model-provider-page/declarations'

export const useGetCredential = (provider: string, isModelCredential?: boolean, credentialId?: string, model?: CustomModel, configFrom?: string) => {
  const providerData = useGetProviderCredential(!isModelCredential && !!credentialId, provider, credentialId)
  const modelData = useGetModelCredential(!!isModelCredential && (!!credentialId || !!model), provider, credentialId, model?.model, model?.model_type, configFrom)
  return isModelCredential ? modelData : providerData
}

export const useAuthService = (provider: string) => {
  const { mutateAsync: addProviderCredential } = useAddProviderCredential(provider)
  const { mutateAsync: editProviderCredential } = useEditProviderCredential(provider)
  const { mutateAsync: deleteProviderCredential } = useDeleteProviderCredential(provider)
  const { mutateAsync: activeProviderCredential } = useActiveProviderCredential(provider)

  const { mutateAsync: addModelCredential } = useAddModelCredential(provider)
  const { mutateAsync: activeModelCredential } = useActiveModelCredential(provider)
  const { mutateAsync: deleteModelCredential } = useDeleteModelCredential(provider)
  const { mutateAsync: editModelCredential } = useEditModelCredential(provider)

  const getAddCredentialService = useCallback((isModel: boolean) => {
    return isModel ? addModelCredential : addProviderCredential
  }, [addModelCredential, addProviderCredential])

  const getEditCredentialService = useCallback((isModel: boolean) => {
    return isModel ? editModelCredential : editProviderCredential
  }, [editModelCredential, editProviderCredential])

  const getDeleteCredentialService = useCallback((isModel: boolean) => {
    return isModel ? deleteModelCredential : deleteProviderCredential
  }, [deleteModelCredential, deleteProviderCredential])

  const getActiveCredentialService = useCallback((isModel: boolean) => {
    return isModel ? activeModelCredential : activeProviderCredential
  }, [activeModelCredential, activeProviderCredential])

  return {
    getAddCredentialService,
    getEditCredentialService,
    getDeleteCredentialService,
    getActiveCredentialService,
  }
}
