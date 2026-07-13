import type { Dispatch, SetStateAction } from 'react'
import type { ModalState } from '../modal-context'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { IS_CLOUD_EDITION } from '@/config'
import { isServer } from '@/utils/client'
import { useLocalStorage } from 'foxact/use-local-storage'

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
  setShowTriggerEventsLimitModal: Dispatch<
    SetStateAction<ModalState<TriggerEventsLimitModalPayload> | null>
  >
  persistTriggerEventsLimitModalDismiss: () => void
}

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'
const TRIGGER_EVENTS_LOCALSTORAGE_FALLBACK_KEY = `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-fallback`
const rawStorageOptions = { raw: true } as const

export const useTriggerEventsLimitModal = ({
  plan,
  isFetchedPlan,
  currentWorkspaceId,
}: UseTriggerEventsLimitModalOptions): UseTriggerEventsLimitModalResult => {
  const [showTriggerEventsLimitModal, setShowTriggerEventsLimitModal] =
    useState<ModalState<TriggerEventsLimitModalPayload> | null>(null)
  const dismissedTriggerEventsLimitStorageKeysRef = useRef<Record<string, boolean>>({})
  const triggerEventsLimitModalState = useMemo(() => {
    if (!IS_CLOUD_EDITION) return null
    if (!currentWorkspaceId) return null
    if (!isFetchedPlan) return null

    const { type, usage, total, reset } = plan
    const isUnlimited = total.triggerEvents === NUM_INFINITE
    const reachedLimit = total.triggerEvents > 0 && usage.triggerEvents >= total.triggerEvents

    if (type === Plan.team || isUnlimited || !reachedLimit) return null

    const resetInDays =
      type === Plan.professional && total.triggerEvents !== NUM_INFINITE
        ? (reset.triggerEvents ?? undefined)
        : undefined
    const cycleTag = (() => {
      if (typeof reset.triggerEvents === 'number')
        return dayjs().startOf('day').add(reset.triggerEvents, 'day').format('YYYY-MM-DD')
      if (type === Plan.sandbox) return dayjs().endOf('month').format('YYYY-MM-DD')
      return 'none'
    })()

    return {
      resetInDays,
      storageKey: `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${type}-${total.triggerEvents}-${cycleTag}`,
    }
  }, [plan, isFetchedPlan, currentWorkspaceId])
  const [
    persistedTriggerEventsLimitDismiss,
    setPersistedTriggerEventsLimitDismiss,
  ] = useLocalStorage<string>(
    triggerEventsLimitModalState?.storageKey ?? TRIGGER_EVENTS_LOCALSTORAGE_FALLBACK_KEY,
    undefined,
    rawStorageOptions,
  )

  useEffect(() => {
    if (!IS_CLOUD_EDITION) return
    if (isServer) return
    if (!currentWorkspaceId) return
    if (!isFetchedPlan) {
      setShowTriggerEventsLimitModal(null)
      return
    }

    if (!triggerEventsLimitModalState) {
      if (showTriggerEventsLimitModal) setShowTriggerEventsLimitModal(null)
      return
    }

    const { resetInDays, storageKey } = triggerEventsLimitModalState
    if (dismissedTriggerEventsLimitStorageKeysRef.current[storageKey]) return
    if (persistedTriggerEventsLimitDismiss === '1') return

    if (showTriggerEventsLimitModal?.payload.storageKey === storageKey) return

    setShowTriggerEventsLimitModal({
      payload: {
        usage: plan.usage.triggerEvents,
        total: plan.total.triggerEvents,
        resetInDays,
        storageKey,
        persistDismiss: true,
      },
    })
  }, [plan, isFetchedPlan, showTriggerEventsLimitModal, currentWorkspaceId, triggerEventsLimitModalState, persistedTriggerEventsLimitDismiss])

  const persistTriggerEventsLimitModalDismiss = useCallback(() => {
    const storageKey = showTriggerEventsLimitModal?.payload.storageKey
    if (!storageKey) return
    if (showTriggerEventsLimitModal?.payload.persistDismiss)
      setPersistedTriggerEventsLimitDismiss('1')
    dismissedTriggerEventsLimitStorageKeysRef.current[storageKey] = true
  }, [showTriggerEventsLimitModal, setPersistedTriggerEventsLimitDismiss])

  return {
    showTriggerEventsLimitModal,
    setShowTriggerEventsLimitModal,
    persistTriggerEventsLimitModalDismiss,
  }
}
