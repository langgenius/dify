'use client'

import type { MovedAccountSettingTab } from './destinations'
import { useCallback } from 'react'
import { useRouter } from '@/next/navigation'
import { getMovedAccountSettingDestination } from './destinations'

type IntegrationsSettingState = {
  payload: MovedAccountSettingTab
}

export const useIntegrationsSetting = () => {
  const router = useRouter()

  return useCallback((state: IntegrationsSettingState) => {
    const movedDestination = getMovedAccountSettingDestination(state.payload)
    if (movedDestination)
      router.push(movedDestination)
  }, [router])
}
