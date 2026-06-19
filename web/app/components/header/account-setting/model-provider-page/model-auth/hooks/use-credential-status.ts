import type {
  ModelProvider,
} from '../../declarations'
import { useMemo } from 'react'

export const useCredentialStatus = (provider: ModelProvider | undefined) => {
  const {
    current_credential_id,
    current_credential_name,
    available_credentials,
  } = provider?.custom_configuration ?? {}
  const hasCredential = !!available_credentials?.length
  const authRemoved = hasCredential && !current_credential_id && !current_credential_name
  const currentCredential = available_credentials?.find(credential => credential.credential_id === current_credential_id)
  const notAllowedToUse = currentCredential?.not_allowed_to_use
  const authorized = !!(current_credential_id && current_credential_name && !notAllowedToUse)

  return useMemo(() => ({
    hasCredential,
    authorized,
    authRemoved,
    current_credential_id,
    current_credential_name,
    available_credentials,
    notAllowedToUse,
  }), [hasCredential, authorized, authRemoved, current_credential_id, current_credential_name, available_credentials, notAllowedToUse])
}
