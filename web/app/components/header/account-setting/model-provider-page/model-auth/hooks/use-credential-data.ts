import { useMemo } from 'react'
import { useGetCredential } from './use-auth-service'
import type {
  Credential,
  CustomModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'

export const useCredentialData = (provider: ModelProvider, providerFormSchemaPredefined: boolean, isModelCredential?: boolean, credential?: Credential, model?: CustomModelCredential) => {
  const configFrom = useMemo(() => {
    if (providerFormSchemaPredefined)
      return 'predefined-model'
    return 'custom-model'
  }, [providerFormSchemaPredefined])
  const {
    isLoading,
    data: credentialData = {},
  } = useGetCredential(provider.provider, isModelCredential, credential?.credential_id, model, configFrom)

  return {
    isLoading,
    credentialData,
  }
}
