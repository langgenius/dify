import type { Dispatch, SetStateAction } from 'react'
import type { ModalState } from '../modal-context'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { IS_CLOUD_EDITION } from '@/config'
import { isServer } from '@/utils/client'

export type TriggerEventsLimitModalPayload = {
  usage: number
  total: number
  resetInDays?: number
  storageKey?: string
  persistDismiss?: boolean
}

type TriggerPlanInfo = {
  type: Plan
  usage: { triggerEvents: number }
  total: { triggerEvents: number }
  reset: { triggerEvents?: number | null }
}

type UseTriggerEventsLimitModalOptions = {
  plan: TriggerPlanInfo
  isFetchedPlan: boolean
  currentWorkspaceId?: string
}

type UseTriggerEventsLimitModalResult = {
  showTriggerEventsLimitModal: ModalState<TriggerEventsLimitModalPayload> | null
  setShowTriggerEventsLimitModal: Dispatch<SetStateAction<ModalState<TriggerEventsLimitModalPayload> | null>>
  persistTriggerEventsLimitModalDismiss: () => void
}

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'

export const useTriggerEventsLimitModal = ({
  plan,
  isFetchedPlan,
  currentWorkspaceId,
}: UseTriggerEventsLimitModalOptions): UseTriggerEventsLimitModalResult => {
  const [showTriggerEventsLimitModal, setShowTriggerEventsLimitModal] = useState<ModalState<TriggerEventsLimitModalPayload> | null>(null)
  const dismissedTriggerEventsLimitStorageKeysRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return
    if (isServer)
      return
    if (!currentWorkspaceId)
      return
    if (!isFetchedPlan) {
      setShowTriggerEventsLimitModal(null)
      return
    }

    const { type, usage, total, reset } = plan
    const isUnlimited = total.triggerEvents === NUM_INFINITE
    const reachedLimit = total.triggerEvents > 0 && usage.triggerEvents >= total.triggerEvents

    if (type === Plan.team || isUnlimited || !reachedLimit) {
      if (showTriggerEventsLimitModal)
        setShowTriggerEventsLimitModal(null)
      return
    }

    const triggerResetInDays = type === Plan.professional && total.triggerEvents !== NUM_INFINITE
      ? reset.triggerEvents ?? undefined
      : undefined
    const cycleTag = (() => {
      if (typeof reset.triggerEvents === 'number')
        return dayjs().startOf('day').add(reset.triggerEvents, 'day').format('YYYY-MM-DD')
      if (type === Plan.sandbox)
        return dayjs().endOf('month').format('YYYY-MM-DD')
      return 'none'
    })()
    const storageKey = `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${type}-${total.triggerEvents}-${cycleTag}`
    if (dismissedTriggerEventsLimitStorageKeysRef.current[storageKey])
      return

    let persistDismiss = true
    let hasDismissed = false
    try {
      if (localStorage.getItem(storageKey) === '1')
        hasDismissed = true
    }
    catch {
      persistDismiss = false
    }
    if (hasDismissed)
      return

    if (showTriggerEventsLimitModal?.payload.storageKey === storageKey)
      return

    setShowTriggerEventsLimitModal({
      payload: {
        usage: usage.triggerEvents,
        total: total.triggerEvents,
        resetInDays: triggerResetInDays,
        storageKey,
        persistDismiss,
      },
    })
  }, [plan, isFetchedPlan, showTriggerEventsLimitModal, currentWorkspaceId])

  const persistTriggerEventsLimitModalDismiss = useCallback(() => {
    const storageKey = showTriggerEventsLimitModal?.payload.storageKey
    if (!storageKey)
      return
    if (showTriggerEventsLimitModal?.payload.persistDismiss) {
      try {
        localStorage.setItem(storageKey, '1')
        return
      }
      catch {
        // ignore error and fall back to in-memory guard
      }
    }
    dismissedTriggerEventsLimitStorageKeysRef.current[storageKey] = true
  }, [showTriggerEventsLimitModal])

  return {
    showTriggerEventsLimitModal,
    setShowTriggerEventsLimitModal,
    persistTriggerEventsLimitModalDismiss,
  }
}
