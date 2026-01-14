'use client'
import type { AppDetailResponse } from '@/models/app'
import type { AppTrigger } from '@/service/use-tools'
import type { AppSSO } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import Link from 'next/link'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import Switch from '@/app/components/base/switch'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import {

  useAppTriggers,
  useInvalidateAppTriggers,
  useUpdateTriggerStatus,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { canFindTool } from '@/utils'

export type ITriggerCardProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
  onToggleResult?: (err: Error | null, message?: I18nKeysByPrefix<'common', 'actionMsg.'>) => void
}

const getTriggerIcon = (trigger: AppTrigger, triggerPlugins: any[]) => {
  const { trigger_type, status, provider_name } = trigger

  // Status dot styling based on trigger status
  const getStatusDot = () => {
    if (status === 'enabled') {
      return (
        <div className="absolute -left-0.5 -top-0.5 h-1.5 w-1.5 rounded-sm border border-black/15 bg-green-500" />
      )
    }
    else {
      return (
        <div className="absolute -left-0.5 -top-0.5 h-1.5 w-1.5 rounded-sm border border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg shadow-status-indicator-gray-shadow" />
      )
    }
  }

  // Get BlockEnum type from trigger_type
  let blockType: BlockEnum
  switch (trigger_type) {
    case 'trigger-webhook':
      blockType = BlockEnum.TriggerWebhook
      break
    case 'trigger-schedule':
      blockType = BlockEnum.TriggerSchedule
      break
    case 'trigger-plugin':
      blockType = BlockEnum.TriggerPlugin
      break
    default:
      blockType = BlockEnum.TriggerWebhook
  }

  let triggerIcon: string | undefined
  if (trigger_type === 'trigger-plugin' && provider_name) {
    const targetTriggers = triggerPlugins || []
    const foundTrigger = targetTriggers.find(triggerWithProvider =>
      canFindTool(triggerWithProvider.id, provider_name)
      || triggerWithProvider.id.includes(provider_name)
      || triggerWithProvider.name === provider_name,
    )
    triggerIcon = foundTrigger?.icon
  }

  return (
    <div className="relative">
      <BlockIcon
        type={blockType}
        size="md"
        toolIcon={triggerIcon}
      />
      {getStatusDot()}
    </div>
  )
}

function TriggerCard({ appInfo, onToggleResult }: ITriggerCardProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const appId = appInfo.id
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { data: triggersResponse, isLoading } = useAppTriggers(appId)
  const { mutateAsync: updateTriggerStatus } = useUpdateTriggerStatus()
  const invalidateAppTriggers = useInvalidateAppTriggers()
  const { data: triggerPlugins } = useAllTriggerPlugins()

  // Zustand store for trigger status sync
  const { setTriggerStatus, setTriggerStatuses } = useTriggerStatusStore()

  const triggers = triggersResponse?.data || []
  const triggerCount = triggers.length

  // Sync trigger statuses to Zustand store when data loads initially or after API calls
  React.useEffect(() => {
    if (triggers.length > 0) {
      const statusMap = triggers.reduce((acc, trigger) => {
        // Map API status to EntryNodeStatus: only 'enabled' shows green, others show gray
        acc[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
        return acc
      }, {} as Record<string, 'enabled' | 'disabled'>)

      // Only update if there are actual changes to prevent overriding optimistic updates
      setTriggerStatuses(statusMap)
    }
  }, [triggers, setTriggerStatuses])

  const onToggleTrigger = async (trigger: AppTrigger, enabled: boolean) => {
    try {
      // Immediately update Zustand store for real-time UI sync
      const newStatus = enabled ? 'enabled' : 'disabled'
      setTriggerStatus(trigger.node_id, newStatus)

      await updateTriggerStatus({
        appId,
        triggerId: trigger.id,
        enableTrigger: enabled,
      })
      invalidateAppTriggers(appId)

      // Success toast notification
      onToggleResult?.(null)
    }
    catch (error) {
      // Rollback Zustand store state on error
      const rollbackStatus = enabled ? 'disabled' : 'enabled'
      setTriggerStatus(trigger.node_id, rollbackStatus)

      // Error toast notification
      onToggleResult?.(error as Error)
    }
  }

  if (isLoading) {
    return (
      <div className="w-full max-w-full rounded-xl border-l-[0.5px] border-t border-effects-highlight">
        <div className="rounded-xl bg-background-default">
          <div className="flex w-full flex-col items-start justify-center gap-3 self-stretch border-b-[0.5px] border-divider-subtle p-3">
            <div className="h-6 w-full animate-pulse rounded bg-components-input-bg-normal"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-full rounded-xl border-l-[0.5px] border-t border-effects-highlight">
      <div className="rounded-xl bg-background-default">
        <div className="flex w-full flex-col items-start justify-center gap-3 self-stretch border-b-[0.5px] border-divider-subtle p-3">
          <div className="flex w-full items-center gap-3 self-stretch">
            <div className="flex grow items-center">
              <div className="mr-2 shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-purple-purple-500 p-1 shadow-md">
                <TriggerAll className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className="group w-full">
                <div className="system-md-semibold min-w-0 overflow-hidden text-ellipsis break-normal text-text-secondary group-hover:text-text-primary">
                  {triggerCount > 0
                    ? t('overview.triggerInfo.triggersAdded', { ns: 'appOverview', count: triggerCount })
                    : t('overview.triggerInfo.noTriggerAdded', { ns: 'appOverview' })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {triggerCount > 0 && (
          <div className="flex flex-col gap-2 p-3">
            {triggers.map(trigger => (
              <div key={trigger.id} className="flex w-full items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="shrink-0">
                    {getTriggerIcon(trigger, triggerPlugins || [])}
                  </div>
                  <div className="system-sm-medium min-w-0 flex-1 truncate text-text-secondary">
                    {trigger.title}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <div className={`${trigger.status === 'enabled' ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase whitespace-nowrap`}>
                    {trigger.status === 'enabled'
                      ? t('overview.status.running', { ns: 'appOverview' })
                      : t('overview.status.disable', { ns: 'appOverview' })}
                  </div>
                </div>
                <div className="shrink-0">
                  <Switch
                    defaultValue={trigger.status === 'enabled'}
                    onChange={enabled => onToggleTrigger(trigger, enabled)}
                    disabled={!isCurrentWorkspaceEditor}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {triggerCount === 0 && (
          <div className="p-3">
            <div className="system-xs-regular leading-4 text-text-tertiary">
              {t('overview.triggerInfo.triggerStatusDescription', { ns: 'appOverview' })}
              {' '}
              <Link
                href={docLink('/use-dify/nodes/trigger/overview')}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-accent hover:underline"
              >
                {t('overview.triggerInfo.learnAboutTriggers', { ns: 'appOverview' })}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TriggerCard
