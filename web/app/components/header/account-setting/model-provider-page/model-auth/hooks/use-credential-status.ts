import { useMemo } from 'react'
import type {
  ModelProvider,
} from '../../declarations'
import { CustomConfigurationStatusEnum } from '../../declarations'

export const useCredentialStatus = (provider: ModelProvider) => {
  const {
    current_credential_id,
    current_credential_name,
    available_credentials,
    status: customConfigurationStatus,
  } = provider.custom_configuration
  const hasCredential = !!available_credentials?.length
  const authorized = customConfigurationStatus === CustomConfigurationStatusEnum.active
  const authRemoved = customConfigurationStatus === CustomConfigurationStatusEnum.removed
  const unAuthorized = customConfigurationStatus === CustomConfigurationStatusEnum.noConfigure || customConfigurationStatus === CustomConfigurationStatusEnum.canceled
  const currentCredential = available_credentials?.find(credential => credential.credential_id === current_credential_id)

  return useMemo(() => ({
    hasCredential,
    authorized,
    authRemoved,
    current_credential_id,
    current_credential_name,
    available_credentials,
    customConfigurationStatus,
    notAllowedToUse: currentCredential?.not_allowed_to_use,
    unAuthorized,
  }), [hasCredential, authorized, authRemoved, current_credential_id, current_credential_name, available_credentials])
}
