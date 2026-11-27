import type {
  Credential,
  CustomModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMemo } from 'react'
import { useGetCredential } from './use-auth-service'

export const useCredentialData = (
  provider: ModelProvider,
  providerFormSchemaPredefined: boolean,
  isModelCredential?: boolean,
  credential?: Credential,
  model?: CustomModelCredential,
) => {
  const configFrom = useMemo(() => {
    if (providerFormSchemaPredefined) return 'predefined-model'
    return 'custom-model'
  }, [providerFormSchemaPredefined])
  const credentialQuery = useGetCredential(
    provider.provider,
    isModelCredential,
    credential?.credential_id,
    model,
    configFrom,
  )

  const { isLoading, data: credentialData = {} } = credentialQuery

  return {
    isLoading,
    credentialData,
    // Only a failed first load leaves no credential to edit; a failed refetch keeps it.
    loadError: credentialQuery.isError && !credentialQuery.data ? credentialQuery.error : undefined,
    isRetrying: credentialQuery.isFetching,
    retry: () => {
      void credentialQuery.refetch()
    },
  }
}
