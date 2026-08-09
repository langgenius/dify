'use client'

import type { AccessPointAppInfo } from '../shared/utils'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { AppTrigger } from '@/service/use-tools'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import {
  useAppTriggers,
  useInvalidateAppTriggers,
  useUpdateTriggerStatus,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { canFindTool } from '@/utils'
import { AccessPointCard, AccessPointEmptyContent } from '../shared/access-point-card'

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

type TriggerAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: 'available' | 'loading' | 'unavailable'
  canEdit: boolean
  highlighted?: boolean
  onToggleResult: (error: Error | null) => void
}

export function TriggerAccessPointCard({
  appInfo,
  availability,
  canEdit,
  highlighted,
  onToggleResult,
}: TriggerAccessPointCardProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: response, isLoading } = useAppTriggers(appInfo.id)
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()
  const { mutateAsync: updateTriggerStatus, isPending: statusUpdating } = useUpdateTriggerStatus()
  const invalidateTriggers = useInvalidateAppTriggers()
  const { setTriggerStatus, setTriggerStatuses } = useTriggerStatusStore()
  const triggers = useMemo(() => response?.data ?? [], [response?.data])
  const loading = availability === 'loading' || isLoading
  const active = availability === 'available' && !loading
  const status = loading ? 'loading' : active ? 'inService' : 'unavailable'
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

  const toggleTrigger = async (trigger: AppTrigger, enabled: boolean) => {
    if (!canEdit) return
    const status = enabled ? 'enabled' : 'disabled'
    setTriggerStatus(trigger.node_id, status)

    try {
      await updateTriggerStatus({
        appId: appInfo.id,
        triggerId: trigger.id,
        enableTrigger: enabled,
      })
      invalidateTriggers(appInfo.id)
      onToggleResult(null)
    } catch (error) {
      setTriggerStatus(trigger.node_id, enabled ? 'disabled' : 'enabled')
      onToggleResult(error as Error)
    }
  }

  return (
    <AccessPointCard
      title={t(($) => $['settings.trigger'], { ns: 'common' })}
      description={t(($) => $['studio.accessPoint.triggerDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-integrations-trigger"
      status={status}
      highlighted={highlighted}
      showStatus={!active}
      busy={statusUpdating}
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
            {triggers.map((trigger) => {
              const enabled = trigger.status === 'enabled'
              const statusLabel = enabled
                ? t(($) => $['agentDetail.access.status.inService'], {
                    ns: 'agentV2',
                  })
                : t(($) => $['overview.status.disable'], {
                    ns: 'appOverview',
                  })

              return (
                <div
                  key={trigger.id}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                >
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
                    disabled={!canEdit || statusUpdating}
                    aria-label={trigger.title}
                    onCheckedChange={(nextEnabled) => void toggleTrigger(trigger, nextEnabled)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </AccessPointCard>
  )
}
