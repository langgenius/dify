import { ENABLE_FEATURE_PREVIEW } from '@/config'

export const isContactsImPlatformEnabled = (imBindingCentrallyManaged: boolean) =>
  ENABLE_FEATURE_PREVIEW && !imBindingCentrallyManaged
