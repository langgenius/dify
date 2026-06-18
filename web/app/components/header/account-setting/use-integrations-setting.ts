'use client'

import type { MovedAccountSettingTab } from './destinations'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { useCallback } from 'react'
import { useModalContext } from '@/context/modal-context'
import { integrationSectionByMovedAccountSettingTab } from './destinations'

type IntegrationsSettingState
  = | { payload: MovedAccountSettingTab, source?: 'agent', onCancelCallback?: () => void }
    | { section: IntegrationSection, source?: 'agent', onCancelCallback?: () => void }

export const useIntegrationsSetting = () => {
  const { setShowAccountSettingModal } = useModalContext()

  return useCallback((state: IntegrationsSettingState) => {
    const section
      = 'section' in state
        ? state.section
        : integrationSectionByMovedAccountSettingTab[state.payload]

    if (section) {
      setShowAccountSettingModal({
        payload: section,
        ...(state.source ? { source: state.source } : {}),
        ...(state.onCancelCallback ? { onCancelCallback: state.onCancelCallback } : {}),
      })
    }
  }, [setShowAccountSettingModal])
}
