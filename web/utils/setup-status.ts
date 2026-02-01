import type { SetupStatusResponse } from '@/models/common'
import { consoleClient } from '@/service/client'

const SETUP_STATUS_KEY = 'setup_status'

const isSetupStatusCached = (): boolean =>
  localStorage.getItem(SETUP_STATUS_KEY) === 'finished'

export const fetchSetupStatusWithCache = async (): Promise<SetupStatusResponse> => {
  if (isSetupStatusCached())
    return { step: 'finished' }

  const status = await consoleClient.setupStatus()

  if (status.step === 'finished')
    localStorage.setItem(SETUP_STATUS_KEY, 'finished')
  else
    localStorage.removeItem(SETUP_STATUS_KEY)

  return status
}
