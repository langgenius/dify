import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider } from '../../declarations'
import { useMemo } from 'react'

export const useCredentialStatus = (
  provider: ModelProvider | ModelProviderSummaryResponse | undefined,
) => {
  const { current_credential_id, current_credential_name, available_credentials } =
    provider?.custom_configuration ?? {}
  const hasCredential = !!available_credentials?.length
  const authRemoved = hasCredential && !current_credential_id && !current_credential_name
  const currentCredential = available_credentials?.find(
    (credential) => credential.credential_id === current_credential_id,
  )
  const summaryCredentialUsable =
    provider && 'current_credential_usable' in provider.custom_configuration
      ? provider.custom_configuration.current_credential_usable
      : undefined
  const notAllowedToUse =
    summaryCredentialUsable === false
      ? true
      : currentCredential && 'not_allowed_to_use' in currentCredential
        ? currentCredential.not_allowed_to_use
        : undefined
  const authorized =
    summaryCredentialUsable !== undefined
      ? summaryCredentialUsable
      : !!(current_credential_id && current_credential_name && !notAllowedToUse)

  return useMemo(
    () => ({
      hasCredential,
      authorized,
      authRemoved,
      current_credential_id,
      current_credential_name: current_credential_name ?? undefined,
      available_credentials,
      notAllowedToUse,
    }),
    [
      hasCredential,
      authorized,
      authRemoved,
      current_credential_id,
      current_credential_name,
      available_credentials,
      notAllowedToUse,
    ],
  )
}
