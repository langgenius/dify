import type { SetupStatusResponse } from '@/models/common'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { fetchSetupStatus } from '@/service/common'
import { storage } from './storage'

const isSetupStatusCached = (): boolean =>
  storage.get<string>(STORAGE_KEYS.CONFIG.SETUP_STATUS) === 'finished'

export const fetchSetupStatusWithCache = async (): Promise<SetupStatusResponse> => {
  if (isSetupStatusCached())
    return { step: 'finished' }

  const status = await fetchSetupStatus()

  if (status.step === 'finished')
    storage.set(STORAGE_KEYS.CONFIG.SETUP_STATUS, 'finished')
  else
    storage.remove(STORAGE_KEYS.CONFIG.SETUP_STATUS)

  return status
}
