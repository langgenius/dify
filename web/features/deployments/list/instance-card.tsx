'use client'

import type { AppInstance } from '@dify/contracts/enterprise/types.gen'
import type { InstanceDetailTabKey } from '../detail/tabs'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { toAppMode } from '../app-mode'

const INSTANCE_CARD_MENU_TAB_KEYS = ['deploy', 'releases', 'settings'] satisfies InstanceDetailTabKey[]

function getInstanceTabHref(appInstanceId: string, tabKey: InstanceDetailTabKey) {
  return `/deployments/${appInstanceId}/${tabKey}`
}

export function InstanceCard({ app }: {
  app: AppInstance
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  if (!app.id)
    return null

  const appInstanceId = app.id
  const appName = app.name ?? appInstanceId
  const appMode = toAppMode(app.mode)
  const detailHref = `/deployments/${appInstanceId}/overview`

  const statusCount = (status: string) =>
    app.statuses?.find(item => item.status === status)?.count ?? 0
  const failedCount = statusCount('failed') + statusCount('deploy_failed')
  const deployingCount = statusCount('deploying')
  const readyCount = statusCount('ready')
  const envCount = failedCount + deployingCount + readyCount

  const lastDeployedAt = app.lastDeployedAt
    ? Date.parse(app.lastDeployedAt)
    : null

  const primaryStatus: 'none' | 'failed' | 'deploying' | 'ready' = envCount === 0
    ? 'none'
    : failedCount > 0
      ? 'failed'
      : deployingCount > 0
        ? 'deploying'
        : 'ready'

  const primaryText = primaryStatus === 'none'
    ? t('card.notDeployed')
    : primaryStatus === 'failed'
      ? t('card.failed', { count: failedCount })
      : primaryStatus === 'deploying'
        ? t('card.deploying', { count: deployingCount })
        : t('card.ready', { count: readyCount })

  const secondaryParts: string[] = []
  if (primaryStatus === 'failed' && deployingCount > 0)
    secondaryParts.push(t('card.deploying', { count: deployingCount }))
  if ((primaryStatus === 'failed' || primaryStatus === 'deploying') && readyCount > 0)
    secondaryParts.push(t('card.ready', { count: readyCount }))

  const statusSummaryLabel = (status?: string) => {
    if (status === 'failed' || status === 'deploy_failed')
      return t('status.deployFailed')
    if (status === 'deploying')
      return t('status.deploying')
    if (status === 'ready')
      return t('status.ready')
    return status || 'unknown'
  }

  const statusSummaryTooltip = app.statuses?.filter(item => item.count && item.status !== 'undeployed') ?? []
  const statusTooltip = primaryStatus === 'none'
    ? t('card.tooltip.notDeployed')
    : (
        <div className="flex min-w-45 flex-col gap-1">
          <div className="system-xs-medium text-text-secondary">{t('overview.deploymentStatus')}</div>
          {statusSummaryTooltip.map(item => (
            <div key={item.status} className="flex justify-between gap-3">
              <span className="text-text-tertiary">{statusSummaryLabel(item.status)}</span>
              <span className="text-text-secondary">{item.count}</span>
            </div>
          ))}
        </div>
      )

  const healthPillClass = primaryStatus === 'none'
    ? 'text-text-tertiary bg-background-section-burn'
    : primaryStatus === 'failed'
      ? 'text-util-colors-red-red-700 bg-util-colors-red-red-50'
      : primaryStatus === 'deploying'
        ? 'text-util-colors-warning-warning-700 bg-util-colors-warning-warning-50'
        : 'text-util-colors-green-green-700 bg-util-colors-green-green-50'

  const healthDotClass = primaryStatus === 'none'
    ? 'bg-text-quaternary'
    : primaryStatus === 'failed'
      ? 'bg-util-colors-red-red-500'
      : primaryStatus === 'deploying'
        ? 'bg-util-colors-warning-warning-500 animate-pulse'
        : 'bg-util-colors-green-green-500'

  const appModeLabel = t(`appMode.${appMode}`, { defaultValue: appMode })

  return (
    <div
      className="group relative col-span-1 inline-flex h-40 cursor-pointer flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs transition-all duration-200 ease-in-out hover:shadow-lg"
    >
      <Link
        href={detailHref}
        className="flex h-full flex-col rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <div className="flex h-16.5 shrink-0 grow-0 items-center gap-3 px-3.5 pt-3.5 pb-3">
          <div className="relative shrink-0">
            <AppIcon
              size="large"
              iconType="emoji"
              icon={app.icon}
              background={app.iconBackground}
            />
            <AppTypeIcon
              type={appMode}
              wrapperClassName="absolute -bottom-0.5 -right-0.5 size-4 shadow-xs"
              className="size-3"
            />
          </div>
          <div className="w-0 grow py-px">
            <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
              <div className="truncate" title={appName}>{appName}</div>
            </div>
            <div className="truncate text-2xs/4.5 font-medium text-text-tertiary" title={appModeLabel}>
              {appModeLabel}
            </div>
          </div>
        </div>
        <div className="flex grow flex-col gap-2 px-3.5">
          <Tooltip>
            <TooltipTrigger
              render={(
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium',
                      healthPillClass,
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', healthDotClass)} />
                    {primaryText}
                  </span>
                  {secondaryParts.length > 0 && (
                    <span className="truncate system-xs-regular text-text-tertiary">
                      {secondaryParts.join(' · ')}
                    </span>
                  )}
                </div>
              )}
            />
            <TooltipContent>{statusTooltip}</TooltipContent>
          </Tooltip>
          <div className="flex min-w-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
            <span aria-hidden className="i-ri-apps-2-line size-3.5 shrink-0 text-text-quaternary" />
            <span className="truncate" title={app.sourceAppName ?? appName}>
              {t('card.fromApp', { name: app.sourceAppName ?? appName })}
            </span>
          </div>
        </div>
        <div className="absolute right-0 bottom-1 left-0 flex h-10.5 shrink-0 items-center pt-1 pr-12 pb-1.5 pl-3.5">
          <div className="flex min-w-0 grow items-center gap-1.5 system-xs-regular text-text-tertiary">
            <span aria-hidden className="i-ri-time-line size-3.5 shrink-0 text-text-quaternary" />
            <span className="truncate">
              {lastDeployedAt
                ? t('card.lastDeployed', { time: formatTimeFromNow(lastDeployedAt) })
                : t('card.neverDeployed')}
            </span>
          </div>
        </div>
      </Link>
      <div className="pointer-events-auto absolute right-1.5 bottom-1 flex h-10.5 items-center">
        <InstanceCardActions appInstanceId={appInstanceId} />
      </div>
    </div>
  )
}

function InstanceCardActions({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('card.moreActions')}
        className={cn(
          'flex size-8 items-center justify-center rounded-md border-none bg-transparent p-2 hover:bg-state-base-hover data-popup-open:bg-state-base-hover data-popup-open:shadow-none',
        )}
      >
        <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-54">
        {INSTANCE_CARD_MENU_TAB_KEYS.map((tabKey) => {
          const href = getInstanceTabHref(appInstanceId, tabKey)

          return (
            <DropdownMenuLinkItem
              key={tabKey}
              className="gap-2 px-3"
              render={<Link href={href} />}
            >
              <span className="system-sm-regular text-text-secondary">{t(`tabs.${tabKey}.name`)}</span>
            </DropdownMenuLinkItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
