import { ENABLE_HITL_IM } from '@/config'

export const isContactsImPlatformEnabled = (imCentrallyManaged: boolean) =>
  ENABLE_HITL_IM && !imCentrallyManaged
