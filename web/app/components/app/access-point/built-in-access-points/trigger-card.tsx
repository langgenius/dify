'use client'

import type {
  AppDetailWithSite,
  WorkflowTriggerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { getErrorMessage } from '@/utils/error-message'
import { TriggerAccessPointList, TriggerAccessPointRow } from '../shared/trigger-access-point-list'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'

function TriggerAccessPointItem({
  appId,
  canManageAccessPoint,
  trigger,
  triggerPlugins,
}: {
  appId: string
  canManageAccessPoint: boolean
  trigger: WorkflowTriggerResponse
  triggerPlugins: TriggerWithProvider[]
}) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const updateTriggerMutation = useMutation(
    consoleQuery.apps.byAppId.triggerEnable.post.mutationOptions({
      context: { silent: true },
      scope: {
        id: `app-trigger-toggle:${appId}:${trigger.id}`,
      },
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.triggers.get.queryKey({
            input: { params: { app_id: appId } },
          }),
        }),
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const pendingEnabled = updateTriggerMutation.variables?.body.enable_trigger
  const enabled =
    updateTriggerMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : trigger.status === 'enabled'
  const handleEnabledChange = (nextEnabled: boolean) => {
    updateTriggerMutation.mutate({
      params: {
        app_id: appId,
      },
      body: {
        trigger_id: trigger.id,
        enable_trigger: nextEnabled,
      },
    })
  }

  return (
    <TriggerAccessPointRow
      title={trigger.title}
      triggerType={trigger.trigger_type}
      providerName={trigger.provider_name ?? undefined}
      enabled={enabled}
      canManageAccessPoint={canManageAccessPoint}
      triggerPlugins={triggerPlugins}
      onEnabledChange={handleEnabledChange}
    />
  )
}

type TriggerAccessPointCardProps = {
  appInfo: AppDetailWithSite
  availability: 'available' | 'loading' | 'unavailable'
  canManageAccessPoint: boolean
  highlighted?: boolean
}

export function TriggerAccessPointCard({
  appInfo,
  availability,
  canManageAccessPoint,
  highlighted,
}: TriggerAccessPointCardProps) {
  const { t } = useTranslation(['appOverview', 'deployments', 'navigation'])
  const { data: response, isLoading } = useQuery(
    consoleQuery.apps.byAppId.triggers.get.queryOptions({
      input: { params: { app_id: appInfo.id } },
      enabled: !!appInfo.id,
    }),
  )
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()
  const setTriggerStatuses = useTriggerStatusStore((state) => state.setTriggerStatuses)
  const triggers = useMemo(() => response?.data ?? [], [response?.data])
  const loading = availability === 'loading' || isLoading
  const active = availability === 'available' && !loading
  const status = loading ? 'loading' : active ? 'inService' : 'unavailable'
  const statusLabel = useAccessPointStatusLabel(status)
  const enabledCount = triggers.filter((trigger) => trigger.status === 'enabled').length

  useEffect(() => {
    if (!triggers.length) return

    setTriggerStatuses(
      triggers.reduce(
        (statuses, trigger) => {
          statuses[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
          return statuses
        },
        {} as Record<string, 'disabled' | 'enabled'>,
      ),
    )
  }, [setTriggerStatuses, triggers])

  return (
    <AccessPointCard
      title={t(($) => $['settings.trigger'], { ns: 'navigation' })}
      description={t(($) => $['studio.accessPoint.triggerDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-integrations-trigger"
      status={status}
      statusLabel={statusLabel}
      highlighted={highlighted}
      showStatus={!active}
    >
      <TriggerAccessPointList
        loading={loading}
        active={active}
        enabledCount={enabledCount}
        total={triggers.length}
      >
        {triggers.map((trigger) => (
          <TriggerAccessPointItem
            key={trigger.id}
            appId={appInfo.id}
            canManageAccessPoint={canManageAccessPoint}
            trigger={trigger}
            triggerPlugins={triggerPlugins}
          />
        ))}
      </TriggerAccessPointList>
    </AccessPointCard>
  )
}
