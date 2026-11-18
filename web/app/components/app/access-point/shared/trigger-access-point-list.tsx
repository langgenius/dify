'use client'

import type { ReactNode } from 'react'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { AccessPointEmptyContent } from '@/app/components/base/access-point/card'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { canFindTool } from '@/utils'

function TriggerIcon({
  triggerType,
  providerName,
  triggerPlugins,
}: {
  triggerType?: string
  providerName?: string
  triggerPlugins: TriggerWithProvider[]
}) {
  const blockType =
    triggerType === 'trigger-schedule'
      ? BlockEnum.TriggerSchedule
      : triggerType === 'trigger-plugin'
        ? BlockEnum.TriggerPlugin
        : BlockEnum.TriggerWebhook
  const pluginTrigger =
    triggerType === 'trigger-plugin' && providerName
      ? triggerPlugins.find(
          (candidate) =>
            canFindTool(candidate.id, providerName) ||
            candidate.id.includes(providerName) ||
            candidate.name === providerName,
        )
      : undefined
  const toolIcon = typeof pluginTrigger?.icon === 'string' ? pluginTrigger.icon : undefined

  return (
    <span>
      <BlockIcon type={blockType} size="md" toolIcon={toolIcon} />
    </span>
  )
}

// One trigger of the Built-in and deployed environment Trigger cards; the caller owns the switch.
export function TriggerAccessPointRow({
  title,
  triggerType,
  providerName,
  enabled,
  canManageAccessPoint,
  triggerPlugins,
  onEnabledChange,
}: {
  title?: string
  triggerType?: string
  providerName?: string
  enabled: boolean
  canManageAccessPoint: boolean
  triggerPlugins: TriggerWithProvider[]
  onEnabledChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation(['agentV2', 'appOverview'])
  const statusLabel = enabled
    ? t(($) => $['agentDetail.access.status.inService'], {
        ns: 'agentV2',
      })
    : t(($) => $['overview.status.disable'], {
        ns: 'appOverview',
      })

  return (
    <div className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-state-base-hover">
      <TriggerIcon
        triggerType={triggerType}
        providerName={providerName}
        triggerPlugins={triggerPlugins}
      />
      <span className="w-28 shrink-0 truncate system-sm-medium text-text-secondary">{title}</span>
      <span className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
        {providerName}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 system-xs-semibold-uppercase ${
          enabled ? 'text-text-secondary' : 'text-text-tertiary'
        }`}
      >
        <StatusDot size="small" status={enabled ? 'success' : 'disabled'} />
        {statusLabel}
      </span>
      <Switch
        checked={enabled}
        disabled={!canManageAccessPoint}
        aria-label={title}
        onCheckedChange={(nextEnabled) => {
          if (canManageAccessPoint) onEnabledChange(nextEnabled)
        }}
      />
    </div>
  )
}

// The body of a Trigger card: loading, the empty explanation, or the enabled count and rows.
export function TriggerAccessPointList({
  loading,
  active,
  enabledCount,
  total,
  children,
}: {
  loading: boolean
  active: boolean
  enabledCount: number
  total: number
  children: ReactNode
}) {
  const { t } = useTranslation(['appOverview', 'deployments'])
  const docLink = useDocLink()

  return (
    <>
      {loading && (
        <div className="flex h-full min-h-40 flex-col gap-4 px-4 py-5">
          <span className="h-2 w-24 animate-pulse rounded-full bg-text-quaternary opacity-20 motion-reduce:animate-none" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-text-quaternary opacity-10 motion-reduce:animate-none" />
        </div>
      )}
      {!loading && (!active || total === 0) && (
        <AccessPointEmptyContent>
          <span>
            {t(($) => $['overview.triggerInfo.triggerStatusDescription'], {
              ns: 'appOverview',
            })}{' '}
            <Link
              href={docLink('/use-dify/nodes/trigger/overview')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-accent underline"
            >
              {t(($) => $['overview.triggerInfo.learnAboutTriggers'], {
                ns: 'appOverview',
              })}
            </Link>
          </span>
        </AccessPointEmptyContent>
      )}
      {active && total > 0 && (
        <div className="flex flex-col px-4 py-3">
          <div className="flex h-6 items-center system-xs-medium-uppercase text-text-secondary">
            {t(($) => $['studio.accessPoint.triggerEnabledCount'], {
              ns: 'deployments',
              enabled: enabledCount,
              total,
            })}
          </div>
          <div className="mt-1 flex flex-col gap-1">{children}</div>
        </div>
      )}
    </>
  )
}
