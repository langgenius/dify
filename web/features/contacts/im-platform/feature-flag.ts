import { ENABLE_FEATURE_PREVIEW } from '@/config'

export const isContactsImPlatformEnabled = (imCentrallyManaged: boolean) =>
  ENABLE_FEATURE_PREVIEW && !imCentrallyManaged
