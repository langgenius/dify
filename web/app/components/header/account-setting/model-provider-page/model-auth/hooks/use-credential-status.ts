import { useMemo } from 'react'
import type {
  ModelProvider,
} from '../../declarations'

export const useCredentialStatus = (provider: ModelProvider) => {
  const {
    current_credential_id,
    current_credential_name,
    available_credentials,
  } = provider.custom_configuration
  const hasCredential = !!available_credentials?.length
  const authorized = current_credential_id && current_credential_name
  const authRemoved = hasCredential && !current_credential_id && !current_credential_name
  const currentCredential = available_credentials?.find(credential => credential.credential_id === current_credential_id)

  return useMemo(() => ({
    hasCredential,
    authorized,
    authRemoved,
    current_credential_id,
    current_credential_name,
    available_credentials,
    notAllowedToUse: currentCredential?.not_allowed_to_use,
  }), [hasCredential, authorized, authRemoved, current_credential_id, current_credential_name, available_credentials])
}
