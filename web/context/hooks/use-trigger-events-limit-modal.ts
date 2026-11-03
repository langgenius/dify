import type { BillingQuota } from '@/app/components/billing/quota'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getTriggerEventsQuota } from '@/app/components/billing/quota'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

type UseTriggerEventsLimitModalResult = {
  triggerEventsLimitModal: BillingQuota | null
  dismissTriggerEventsLimitModal: () => void
}

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'

export const useTriggerEventsLimitModal = (): UseTriggerEventsLimitModalResult => {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { data: triggerEvents } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: ({ billing, trigger_event }) => ({
        plan: billing.subscription.plan,
        quota: getTriggerEventsQuota(trigger_event, billing.subscription.plan),
      }),
    }),
  )
  const [dismissedCycles, setDismissedCycles] = useState<Record<string, boolean>>({})
  const resetInDays = triggerEvents?.quota.resetInDays
  const cycleTag =
    resetInDays !== undefined
      ? dayjs().startOf('day').add(resetInDays, 'day').format('YYYY-MM-DD')
      : triggerEvents?.plan === 'sandbox'
        ? dayjs().endOf('month').format('YYYY-MM-DD')
        : 'none'
  const storageKey =
    deploymentEdition === 'CLOUD' &&
    currentWorkspaceId &&
    triggerEvents &&
    triggerEvents.plan !== 'team' &&
    triggerEvents.quota.limit !== 'unlimited' &&
    triggerEvents.quota.usage >= triggerEvents.quota.limit
      ? `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${triggerEvents.plan}-${triggerEvents.quota.limit}-${cycleTag}`
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
      storageKey && dismissed === false && triggerEvents ? triggerEvents.quota : null,
    dismissTriggerEventsLimitModal,
  }
}
