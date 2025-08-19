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

  return useMemo(() => ({
    hasCredential,
    authorized,
    authRemoved,
    current_credential_id,
    current_credential_name,
    available_credentials,
  }), [hasCredential, authorized, authRemoved, current_credential_id, current_credential_name, available_credentials])
}
