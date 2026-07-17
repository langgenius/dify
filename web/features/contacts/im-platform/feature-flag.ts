import { ENABLE_FEATURE_PREVIEW } from '@/config'

export const isContactsImPlatformEnabled = (isEnterprisePlan: boolean) =>
  ENABLE_FEATURE_PREVIEW && !isEnterprisePlan
