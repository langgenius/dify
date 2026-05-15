'use client'

import type { AccountSettingTab } from './constants'
import type { ModalState } from '@/context/modal-context'
import { useCallback } from 'react'
import { useModalContext } from '@/context/modal-context'
import { useRouter } from '@/next/navigation'
import { getMovedAccountSettingDestination } from './destinations'

export const useIntegrationsSetting = () => {
  const router = useRouter()
  const { setShowAccountSettingModal } = useModalContext()

  return useCallback((state: ModalState<AccountSettingTab> | null) => {
    if (!state) {
      setShowAccountSettingModal(null)
      return
    }

    const movedDestination = getMovedAccountSettingDestination(state.payload)
    if (movedDestination) {
      router.push(movedDestination)
      return
    }

    setShowAccountSettingModal(state)
  }, [router, setShowAccountSettingModal])
}
