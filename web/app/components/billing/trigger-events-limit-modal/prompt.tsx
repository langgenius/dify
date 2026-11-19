'use client'
import type { BillingQuota } from '@/app/components/billing/quota'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { getTriggerEventsQuota } from '@/app/components/billing/quota'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import TriggerEventsLimitModal from './index'

const TRIGGER_EVENTS_LOCALSTORAGE_PREFIX = 'trigger-events-limit-dismissed'

export function TriggerEventsLimitPrompt() {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: triggerEvents } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: ({ billing, trigger_event }) => ({
        plan: billing.subscription.plan,
        quota: getTriggerEventsQuota(trigger_event, billing.subscription.plan),
      }),
    }),
  )
  const [dismissedCycles, setDismissedCycles] = useState<ReadonlySet<string>>(() => new Set())
  const resetInDays = triggerEvents?.quota.resetInDays
  const cycleTag =
    resetInDays !== undefined
      ? dayjs().startOf('day').add(resetInDays, 'day').format('YYYY-MM-DD')
      : triggerEvents?.plan === 'sandbox'
        ? dayjs().endOf('month').format('YYYY-MM-DD')
        : 'none'
  const storageKey =
    currentWorkspaceId &&
    triggerEvents &&
    triggerEvents.plan !== 'team' &&
    triggerEvents.quota.limit !== 'unlimited' &&
    triggerEvents.quota.usage >= triggerEvents.quota.limit
      ? `${TRIGGER_EVENTS_LOCALSTORAGE_PREFIX}-${currentWorkspaceId}-${triggerEvents.plan}-${triggerEvents.quota.limit}-${cycleTag}`
      : null
  return storageKey && triggerEvents ? (
    <CycleQuotaPrompt
      key={storageKey}
      storageKey={storageKey}
      quota={triggerEvents.quota}
      dismissed={dismissedCycles.has(storageKey)}
      onDismiss={() => setDismissedCycles((cycles) => new Set(cycles).add(storageKey))}
    />
  ) : null
}

function CycleQuotaPrompt({
  storageKey,
  quota,
  dismissed,
  onDismiss,
}: {
  storageKey: string
  quota: BillingQuota
  dismissed: boolean
  onDismiss: () => void
}) {
  const [persisted, persist] = useLocalStorage<string>(storageKey, '0', { raw: true })

  return (
    <TriggerEventsLimitModal
      show={!dismissed && persisted !== '1'}
      quota={quota}
      onClose={() => {
        // Dismiss for this session even if the browser blocks storage writes.
        onDismiss()
        persist('1')
      }}
    />
  )
}
