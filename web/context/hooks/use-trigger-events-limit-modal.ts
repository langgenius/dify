import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { isServer } from '@/utils/client'

type TriggerEventsLimitModalContent = {
  usage: number
  total: number
  resetInDays?: number
}

type TriggerEventsLimitModalState = TriggerEventsLimitModalContent & {
  storageKey: string
  persistDismiss: boolean
}

type TriggerPlanInfo = {
  type: CloudPlan
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
  triggerEventsLimitModal: TriggerEventsLimitModalContent | null
  dismissTriggerEventsLimitModal: () => void
}

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'

export const useTriggerEventsLimitModal = ({
  plan,
  isFetchedPlan,
  currentWorkspaceId,
}: UseTriggerEventsLimitModalOptions): UseTriggerEventsLimitModalResult => {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const [triggerEventsLimitModal, setTriggerEventsLimitModal] =
    useState<TriggerEventsLimitModalState | null>(null)
  const dismissedTriggerEventsLimitStorageKeysRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    if (deploymentEdition !== 'CLOUD') return
    if (isServer) return
    if (!currentWorkspaceId) return
    if (!isFetchedPlan) {
      setTriggerEventsLimitModal(null)
      return
    }

    const { type, usage, total, reset } = plan
    const isUnlimited = total.triggerEvents === NUM_INFINITE
    const reachedLimit = total.triggerEvents > 0 && usage.triggerEvents >= total.triggerEvents

    if (type === 'team' || isUnlimited || !reachedLimit) {
      if (triggerEventsLimitModal) setTriggerEventsLimitModal(null)
      return
    }

    const triggerResetInDays =
      type === 'professional' && total.triggerEvents !== NUM_INFINITE
        ? (reset.triggerEvents ?? undefined)
        : undefined
    const cycleTag = (() => {
      if (typeof reset.triggerEvents === 'number')
        return dayjs().startOf('day').add(reset.triggerEvents, 'day').format('YYYY-MM-DD')
      if (type === 'sandbox') return dayjs().endOf('month').format('YYYY-MM-DD')
      return 'none'
    })()
    const storageKey = `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${type}-${total.triggerEvents}-${cycleTag}`
    if (dismissedTriggerEventsLimitStorageKeysRef.current[storageKey]) return

    let persistDismiss = true
    let hasDismissed = false
    try {
      if (localStorage.getItem(storageKey) === '1') hasDismissed = true
    } catch {
      persistDismiss = false
    }
    if (hasDismissed) return

    if (triggerEventsLimitModal?.storageKey === storageKey) return

    setTriggerEventsLimitModal({
      usage: usage.triggerEvents,
      total: total.triggerEvents,
      resetInDays: triggerResetInDays,
      storageKey,
      persistDismiss,
    })
  }, [plan, isFetchedPlan, triggerEventsLimitModal, currentWorkspaceId, deploymentEdition])

  const dismissTriggerEventsLimitModal = useCallback(() => {
    if (!triggerEventsLimitModal) return

    const { storageKey, persistDismiss } = triggerEventsLimitModal
    if (persistDismiss) {
      try {
        localStorage.setItem(storageKey, '1')
        setTriggerEventsLimitModal(null)
        return
      } catch {
        // ignore error and fall back to in-memory guard
      }
    }
    dismissedTriggerEventsLimitStorageKeysRef.current[storageKey] = true
    setTriggerEventsLimitModal(null)
  }, [triggerEventsLimitModal])

  return {
    triggerEventsLimitModal,
    dismissTriggerEventsLimitModal,
  }
}
