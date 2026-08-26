import { ENABLE_FEATURE_PREVIEW } from '@/config'

export const isContactsImPlatformEnabled = (isEnterpriseEdition: boolean) =>
  ENABLE_FEATURE_PREVIEW && !isEnterpriseEdition
