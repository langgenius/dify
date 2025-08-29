'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { Schedule, TriggerAll, WebhookLine } from '@/app/components/base/icons/src/vender/workflow'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import Indicator from '@/app/components/header/indicator'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { useAppContext } from '@/context/app-context'
import {
  type AppTrigger,
  useAppTriggers,
  useInvalidateAppTriggers,
  useUpdateTriggerStatus,
} from '@/service/use-tools'

export type ITriggerCardProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
}

const getTriggerIcon = (triggerType: string) => {
  switch (triggerType) {
    case 'trigger-webhook':
      return <WebhookLine className="h-4 w-4 text-text-secondary" />
    case 'trigger-schedule':
      return <Schedule className="h-4 w-4 text-text-secondary" />
    case 'trigger-plugin':
      return <WebhookLine className="h-4 w-4 text-text-secondary" />
    default:
      return <WebhookLine className="h-4 w-4 text-text-secondary" />
  }
}

function TriggerCard({ appInfo }: ITriggerCardProps) {
  const { t } = useTranslation()
  const appId = appInfo.id
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { data: triggersResponse, isLoading } = useAppTriggers(appId)
  const { mutateAsync: updateTriggerStatus } = useUpdateTriggerStatus()
  const invalidateAppTriggers = useInvalidateAppTriggers()

  const triggers = triggersResponse?.data || []
  const triggerCount = triggers.length

  const onToggleTrigger = async (trigger: AppTrigger, enabled: boolean) => {
    try {
      await updateTriggerStatus({
        appId,
        triggerId: trigger.id,
        enableTrigger: enabled,
      })
      invalidateAppTriggers(appId)
    }
 catch (error) {
      console.error('Failed to update trigger status:', error)
    }
  }

  const handleLearnMoreClick = () => {
    console.log('Learn about Triggers clicked')
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
              <div className="mr-2 shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-500 p-1 shadow-md">
                <TriggerAll className="h-4 w-4 text-text-primary-on-surface" />
              </div>
              <div className="group w-full">
                <div className="system-md-semibold min-w-0 overflow-hidden text-ellipsis break-normal text-text-secondary group-hover:text-text-primary">
                  {t('appOverview.overview.triggerInfo.title')}
                </div>
              </div>
            </div>
            <div className="system-xs-medium text-text-tertiary">
              {triggerCount > 0
                ? t('appOverview.overview.triggerInfo.triggersAdded', { count: triggerCount })
                : t('appOverview.overview.triggerInfo.noTriggerAdded')
              }
            </div>
          </div>
        </div>

        {triggerCount > 0 && (
          <div className="flex flex-col gap-2 p-3">
            {triggers.map((trigger, index) => (
              <div key={trigger.id}>
                <div className="flex w-full items-center gap-3">
                  <div className="flex grow items-center gap-2">
                    {getTriggerIcon(trigger.trigger_type)}
                    <div className="system-sm-medium text-text-secondary">
                      {trigger.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Indicator color={trigger.status === 'enabled' ? 'green' : 'yellow'} />
                    <div className={`${trigger.status === 'enabled' ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                      {trigger.status === 'enabled'
                        ? t('appOverview.overview.status.running')
                        : t('appOverview.overview.status.disable')}
                    </div>
                  </div>
                  <Switch
                    defaultValue={trigger.status === 'enabled'}
                    onChange={enabled => onToggleTrigger(trigger, enabled)}
                    disabled={!isCurrentWorkspaceEditor}
                  />
                </div>
                {index < triggers.length - 1 && (
                  <Divider className="my-2" />
                )}
              </div>
            ))}
          </div>
        )}

        {triggerCount === 0 && (
          <div className="p-3">
            <Divider className="mb-3" />
            <div className="system-xs-regular leading-4 text-text-quaternary">
              {t('appOverview.overview.triggerInfo.triggerStatusDescription')}{' '}
              <Link
                href="#"
                onClick={handleLearnMoreClick}
                className="text-text-accent hover:underline"
              >
                {t('appOverview.overview.triggerInfo.learnAboutTriggers')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TriggerCard
