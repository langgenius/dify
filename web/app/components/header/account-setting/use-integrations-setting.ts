'use client'

import type { MovedAccountSettingTab } from './destinations'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { useCallback } from 'react'
import { useModalContext } from '@/context/modal-context'
import { integrationSectionByMovedAccountSettingTab } from './destinations'

type IntegrationsSettingState
  = | { payload: MovedAccountSettingTab }
    | { section: IntegrationSection }

export const useIntegrationsSetting = () => {
  const { setShowAccountSettingModal } = useModalContext()

  return useCallback((state: IntegrationsSettingState) => {
    const section
      = 'section' in state
        ? state.section
        : integrationSectionByMovedAccountSettingTab[state.payload]

    if (section)
      setShowAccountSettingModal({ payload: section })
  }, [setShowAccountSettingModal])
}
