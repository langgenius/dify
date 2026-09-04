'use client'

import type { AccessPointAppInfo } from '../shared/utils'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { AppTrigger } from '@/service/use-tools'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard, AccessPointEmptyContent } from '@/app/components/base/access-point/card'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useAppTriggers, useInvalidateAppTriggers } from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { canFindTool } from '@/utils'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'

function TriggerIcon({
  trigger,
  triggerPlugins,
}: {
  trigger: AppTrigger
  triggerPlugins: TriggerWithProvider[]
}) {
  const blockType =
    trigger.trigger_type === 'trigger-schedule'
      ? BlockEnum.TriggerSchedule
      : trigger.trigger_type === 'trigger-plugin'
        ? BlockEnum.TriggerPlugin
        : BlockEnum.TriggerWebhook
  const pluginTrigger =
    trigger.trigger_type === 'trigger-plugin' && trigger.provider_name
      ? triggerPlugins.find(
          (candidate) =>
            canFindTool(candidate.id, trigger.provider_name!) ||
            candidate.id.includes(trigger.provider_name!) ||
            candidate.name === trigger.provider_name,
        )
      : undefined
  const toolIcon = typeof pluginTrigger?.icon === 'string' ? pluginTrigger.icon : undefined

  return (
    <span>
      <BlockIcon type={blockType} size="md" toolIcon={toolIcon} />
    </span>
  )
}

function TriggerAccessPointItem({
  appId,
  canManageAccessPoint,
  trigger,
  triggerPlugins,
}: {
  appId: string
  canManageAccessPoint: boolean
  trigger: AppTrigger
  triggerPlugins: TriggerWithProvider[]
}) {
  const { t } = useTranslation()
  const invalidateTriggers = useInvalidateAppTriggers()
  const updateTriggerMutation = useMutation(
    consoleQuery.apps.byAppId.triggerEnable.post.mutationOptions({
      scope: {
        id: `app-trigger-toggle:${appId}:${trigger.id}`,
      },
      onSuccess: () => invalidateTriggers(appId),
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const pendingEnabled = updateTriggerMutation.variables?.body.enable_trigger
  const enabled =
    updateTriggerMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : trigger.status === 'enabled'
  const statusLabel = enabled
    ? t(($) => $['agentDetail.access.status.inService'], {
        ns: 'agentV2',
      })
    : t(($) => $['overview.status.disable'], {
        ns: 'appOverview',
      })

  const handleEnabledChange = (nextEnabled: boolean) => {
    if (!canManageAccessPoint) return

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
    <div className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-state-base-hover">
      <TriggerIcon trigger={trigger} triggerPlugins={triggerPlugins} />
      <span className="w-28 shrink-0 truncate system-sm-medium text-text-secondary">
        {trigger.title}
      </span>
      <span className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
        {trigger.provider_name}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 system-xs-semibold-uppercase ${
          enabled ? 'text-text-success' : 'text-text-tertiary'
        }`}
      >
        <StatusDot size="small" status={enabled ? 'success' : 'disabled'} />
        {statusLabel}
      </span>
      <Switch
        checked={enabled}
        disabled={!canManageAccessPoint}
        aria-label={trigger.title}
        onCheckedChange={handleEnabledChange}
      />
    </div>
  )
}

type TriggerAccessPointCardProps = {
  appInfo: AccessPointAppInfo
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
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: response, isLoading } = useAppTriggers(appInfo.id)
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
      title={t(($) => $['settings.trigger'], { ns: 'common' })}
      description={t(($) => $['studio.accessPoint.triggerDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-integrations-trigger"
      status={status}
      statusLabel={statusLabel}
      highlighted={highlighted}
      showStatus={!active}
    >
      {loading && (
        <div className="flex h-full min-h-40 flex-col gap-4 px-4 py-5">
          <span className="h-2 w-24 animate-pulse rounded-full bg-text-quaternary opacity-20 motion-reduce:animate-none" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
        </div>
      )}
      {!loading && (!active || triggers.length === 0) && (
        <AccessPointEmptyContent>
          <span>
            {t(($) => $['overview.triggerInfo.triggerStatusDescription'], {
              ns: 'appOverview',
            })}{' '}
            <Link
              href={docLink('/use-dify/nodes/trigger/overview')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-accent hover:underline"
            >
              {t(($) => $['overview.triggerInfo.learnAboutTriggers'], {
                ns: 'appOverview',
              })}
            </Link>
          </span>
        </AccessPointEmptyContent>
      )}
      {active && triggers.length > 0 && (
        <div className="flex flex-col px-4 py-3">
          <div className="flex h-6 items-center system-xs-medium-uppercase text-text-secondary">
            {t(($) => $['studio.accessPoint.triggerEnabledCount'], {
              ns: 'deployments',
              enabled: enabledCount,
              total: triggers.length,
            })}
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {triggers.map((trigger) => (
              <TriggerAccessPointItem
                key={trigger.id}
                appId={appInfo.id}
                canManageAccessPoint={canManageAccessPoint}
                trigger={trigger}
                triggerPlugins={triggerPlugins}
              />
            ))}
          </div>
        </div>
      )}
    </AccessPointCard>
  )
}
