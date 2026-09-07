import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getResetInDaysFromDate } from '@/app/components/billing/utils'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'

type TriggerEventsLimitModalContent = {
  usage: number
  total: number
  resetInDays?: number
}

type UseTriggerEventsLimitModalResult = {
  triggerEventsLimitModal: TriggerEventsLimitModalContent | null
  dismissTriggerEventsLimitModal: () => void
}

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'

export const useTriggerEventsLimitModal = (): UseTriggerEventsLimitModalResult => {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { data: quota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: ({ billing, trigger_event }) => ({
        plan: billing.subscription.plan,
        ...trigger_event,
      }),
    }),
  )
  const [dismissedCycles, setDismissedCycles] = useState<Record<string, boolean>>({})
  const resetInDays = quota ? getResetInDaysFromDate(quota.reset_date) : null
  const cycleTag =
    resetInDays !== null
      ? dayjs().startOf('day').add(resetInDays, 'day').format('YYYY-MM-DD')
      : quota?.plan === 'sandbox'
        ? dayjs().endOf('month').format('YYYY-MM-DD')
        : 'none'
  const storageKey =
    deploymentEdition === 'CLOUD' &&
    currentWorkspaceId &&
    quota &&
    quota.plan !== 'team' &&
    quota.limit >= 0 &&
    quota.usage >= quota.limit
      ? `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${quota.plan}-${quota.limit}-${cycleTag}`
      : null
  const dismissed = storageKey ? dismissedCycles[storageKey] : undefined

  useEffect(() => {
    if (!storageKey || dismissed !== undefined) return

    let storedDismissal = false
    try {
      storedDismissal = localStorage.getItem(storageKey) === '1'
    } catch {
      // Storage can be unavailable; dismissal still lasts for this mounted session.
    }
    setDismissedCycles((current) => ({ ...current, [storageKey]: storedDismissal }))
  }, [storageKey, dismissed])

  const dismissTriggerEventsLimitModal = () => {
    if (!storageKey) return

    setDismissedCycles((current) => ({ ...current, [storageKey]: true }))
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      // The in-memory dismissal above also covers failed storage writes.
    }
  }

  return {
    triggerEventsLimitModal:
      storageKey && dismissed === false && quota
        ? {
            usage: quota.usage,
            total: quota.limit,
            resetInDays: quota.plan === 'professional' ? (resetInDays ?? undefined) : undefined,
          }
        : null,
    dismissTriggerEventsLimitModal,
  }
}
