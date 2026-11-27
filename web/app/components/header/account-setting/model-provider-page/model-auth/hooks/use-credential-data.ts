import type {
  Credential,
  CustomModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMemo } from 'react'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
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
  // Only a failed first load leaves no credential to edit; a failed refetch keeps it and the cache
  // reports it. The model modal, the only caller, renders this failure in place of the form.
  const credentialLoad = useOwnedQueryError(credentialQuery)

  return {
    isLoading,
    credentialData,
    loadError: credentialLoad?.error,
    isRetrying: credentialLoad?.retrying ?? false,
    retry: () => credentialLoad?.retry(),
  }
}
