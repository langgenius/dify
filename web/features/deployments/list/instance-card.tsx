'use client'

import type {
  AccessChannels,
  AppInstanceSummary,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactElement } from 'react'
import type { InstanceDetailTabKey } from '../detail/tabs'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { DeploymentActionsMenu } from '../components/deployment-actions'
import { TitleTooltip } from '../components/title-tooltip'
import { EnvironmentDeploymentBadge } from '../deployment-ui'
import { deploymentStatusLabelKey } from '../deployment-ui-utils'
import { CreateReleaseControl } from '../detail/versions-tab/create-release-control'
import { environmentName } from '../environment'
import { formatDate, releaseLabel } from '../release'
import {
  deploymentStatus,
  isUndeployedDeploymentRow,
} from '../runtime-status'
import { openDeployDrawerAtom } from '../store'

const VISIBLE_ENVIRONMENT_COUNT = 3

function getInstanceTabHref(appInstanceId: string, tabKey: InstanceDetailTabKey) {
  return `/deployments/${appInstanceId}/${tabKey}`
}

function hasEnvironment(row: EnvironmentDeployment) {
  return Boolean(row.environment?.id)
}

function isActiveDeployment(row: EnvironmentDeployment) {
  return hasEnvironment(row) && !isUndeployedDeploymentRow(row)
}

function isReleaseDeployed(release: Release | undefined, rows: EnvironmentDeployment[]) {
  if (!release?.id)
    return false

  return rows.some(row => row.currentRelease?.id === release.id)
}

function releaseSourceLabel(release: Release | undefined, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  if (release?.source === 'RELEASE_SOURCE_SOURCE_APP' || release?.sourceAppId)
    return t('versions.sourceAppOption')
  if (release?.source === 'RELEASE_SOURCE_UPLOAD')
    return t('versions.manualDslOption')
  return '—'
}

function ReleaseMetaTooltip({ release, deployed, children }: {
  release?: Release
  deployed: boolean
  children: ReactElement
}) {
  const { t } = useTranslation('deployments')

  if (!release?.id)
    return children

  const rows = [
    { label: t('card.tooltip.releaseName'), value: releaseLabel(release) },
    { label: t('card.tooltip.deploymentStatus'), value: deployed ? t('card.tooltip.deployed') : t('card.tooltip.notDeployedShort') },
    { label: t('card.tooltip.source'), value: releaseSourceLabel(release, t) },
    { label: t('card.tooltip.createdAt'), value: formatDate(release.createdAt) },
  ]

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        <div className="flex min-w-48 flex-col gap-1">
          {rows.map(row => (
            <div key={row.label} className="flex justify-between gap-4">
              <span className="shrink-0 text-text-tertiary">{row.label}</span>
              <span className="min-w-0 truncate text-right text-text-secondary">{row.value}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function EnvironmentChip({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const name = environmentName(row.environment)
  const status = deploymentStatus(row)
  const statusLabel = t(deploymentStatusLabelKey(status))
  const tooltipSummary = [
    name,
    row.currentRelease ? releaseLabel(row.currentRelease) : undefined,
    statusLabel,
  ].filter(Boolean).join(' · ')

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <EnvironmentDeploymentBadge
            row={row}
            showStatus={false}
            summaryLabel={tooltipSummary}
            className="max-w-44"
          />
        )}
      />
      <TooltipContent>
        <span className="whitespace-nowrap text-text-secondary">{tooltipSummary}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function EnvironmentOverflow({ rows }: {
  rows: EnvironmentDeployment[]
}) {
  const { t } = useTranslation('deployments')

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span className="inline-flex h-5 cursor-default items-center rounded-md bg-background-section-burn px-1.5 system-xs-medium text-text-tertiary">
            {t('card.envOverflow', { count: rows.length })}
          </span>
        )}
      />
      <TooltipContent>
        <div className="flex min-w-40 flex-col gap-1">
          {rows.map((row) => {
            const status = deploymentStatus(row)
            const summary = [
              environmentName(row.environment),
              row.currentRelease ? releaseLabel(row.currentRelease) : undefined,
              t(deploymentStatusLabelKey(status)),
            ].filter(Boolean).join(' · ')

            return (
              <span key={row.environment?.id} className="whitespace-nowrap text-text-secondary">{summary}</span>
            )
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function DeploymentStatusContent({
  rows,
  isLoading,
  hasError,
  emptyAction,
}: {
  rows: EnvironmentDeployment[]
  isLoading: boolean
  hasError: boolean
  emptyAction?: ReactElement
}) {
  const { t } = useTranslation('deployments')
  const visibleRows = rows.slice(0, VISIBLE_ENVIRONMENT_COUNT)
  const overflowRows = rows.slice(VISIBLE_ENVIRONMENT_COUNT)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
        <SkeletonRectangle className="my-0 h-5 w-24 animate-pulse rounded-md" />
      </div>
    )
  }

  if (hasError) {
    return (
      <span className="system-xs-regular text-text-tertiary">
        {t('common.loadFailed')}
      </span>
    )
  }

  if (rows.length > 0) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleRows.map(row => (
          <EnvironmentChip key={row.environment?.id} row={row} />
        ))}
        {overflowRows.length > 0 && <EnvironmentOverflow rows={overflowRows} />}
      </div>
    )
  }

  if (emptyAction)
    return <div className="flex min-w-0 items-center">{emptyAction}</div>

  return null
}

function DeploymentAccessLinks({ appInstanceId, access, isLoading }: {
  appInstanceId: string
  access?: AccessChannels
  isLoading?: boolean
}) {
  const { t } = useTranslation('deployments')

  if (isLoading) {
    return (
      <div role="group" aria-label={t('overview.accessStatus')} className="flex min-w-0 grow items-center gap-2">
        <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-sm" />
        <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-sm" />
      </div>
    )
  }

  const links = [
    access?.webAppEnabled
      ? {
          key: 'webapp',
          href: getInstanceTabHref(appInstanceId, 'access'),
          label: t('card.access.webApp'),
          icon: 'i-ri-global-line',
        }
      : undefined,
    access?.webAppEnabled
      ? {
          key: 'cli',
          href: getInstanceTabHref(appInstanceId, 'access'),
          label: t('card.access.cli'),
          icon: 'i-ri-terminal-box-line',
        }
      : undefined,
    access?.developerApiEnabled
      ? {
          key: 'api-tokens',
          href: getInstanceTabHref(appInstanceId, 'api-tokens'),
          label: t('card.access.api'),
          icon: 'i-ri-code-s-slash-line',
        }
      : undefined,
  ].filter((link): link is { key: string, href: string, label: string, icon: string } => Boolean(link))

  if (links.length === 0) {
    return (
      <div role="group" aria-label={t('overview.accessStatus')} className="flex min-w-0 grow items-center gap-1.5 text-text-quaternary">
        <span aria-hidden className="i-ri-link-unlink size-3.5 shrink-0" />
        <span className="truncate system-xs-regular">{t('card.access.none')}</span>
      </div>
    )
  }

  return (
    <div role="group" aria-label={t('overview.accessStatus')} className="flex min-w-0 grow items-center gap-2">
      {links.map(link => (
        <Tooltip key={link.key}>
          <TooltipTrigger
            render={(
              <Link
                href={link.href}
                aria-label={link.label}
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                )}
              >
                <span aria-hidden className={cn('size-3.5', link.icon)} />
              </Link>
            )}
          />
          <TooltipContent>{link.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export function InstanceCard({ summary }: {
  summary: AppInstanceSummary
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const app = summary.appInstance
  const appInstanceId = app?.id ?? ''
  const appName = app?.name ?? appInstanceId
  const detailHref = getInstanceTabHref(appInstanceId, 'overview')
  const instanceIsLoading = false
  const accessChannelsIsLoading = false

  if (!app?.id)
    return null

  const description = app.description?.trim()
  const access = summary.accessChannels
  const releaseRows = summary.latestRelease?.id ? [summary.latestRelease as Release & { id: string }] : []
  const hasRelease = releaseRows.length > 0
  const activeDeploymentRows = summary.environmentDeployments?.filter(isActiveDeployment) ?? []
  const latestRelease = releaseRows[0]
  const latestReleaseTime = latestRelease?.createdAt
  const latestReleaseTimeMs = latestReleaseTime ? Date.parse(latestReleaseTime) : Number.NaN
  const latestReleaseDeployed = isReleaseDeployed(latestRelease, activeDeploymentRows)
  const releaseMeta = latestRelease
    ? [
        releaseLabel(latestRelease),
        Number.isNaN(latestReleaseTimeMs) ? undefined : formatTimeFromNow(latestReleaseTimeMs),
      ].filter(Boolean).join(' · ')
    : t('card.notDeployed')
  const releaseHistoryIsLoading = false
  const statusIsLoading = false
  const statusHasError = false
  const showDeployAction = !statusIsLoading && !statusHasError && hasRelease && activeDeploymentRows.length === 0
  const showFooterCreateReleaseAction = !releaseHistoryIsLoading && !statusIsLoading && !statusHasError && !hasRelease

  return (
    <div
      className="group relative col-span-1 inline-flex min-h-40 min-w-0 cursor-default flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs transition-all duration-200 ease-in-out hover:border-components-panel-border-subtle hover:shadow-md"
    >
      <DeploymentActionsMenu
        appInstanceId={appInstanceId}
        appName={appName}
        className="pointer-events-none absolute top-3 right-3 z-10 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        triggerClassName="data-popup-open:pointer-events-auto data-popup-open:opacity-100"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Link
          href={detailHref}
          className="block min-w-0 rounded-t-xl px-4 pt-4 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <TitleTooltip content={appName}>
            <h3 className="truncate title-md-semi-bold text-text-primary">
              {appName}
            </h3>
          </TitleTooltip>
          {instanceIsLoading
            ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
                </div>
              )
            : (
                description
                  ? (
                      <TitleTooltip content={description}>
                        <p className="mt-2 line-clamp-2 system-xs-regular text-text-tertiary">
                          {description}
                        </p>
                      </TitleTooltip>
                    )
                  : (
                      <p className="mt-2 truncate system-xs-regular text-text-quaternary">
                        {t('card.noDescription')}
                      </p>
                    )
              )}
        </Link>

        <div role="group" aria-label={t('card.tooltip.deploymentStatus')} className="min-h-8 px-4 pt-4 pb-3">
          <DeploymentStatusContent
            rows={activeDeploymentRows}
            isLoading={statusIsLoading}
            hasError={statusHasError}
            emptyAction={showDeployAction
              ? (
                  <Button
                    variant="secondary-accent"
                    size="small"
                    className="max-w-full"
                    onClick={() => openDeployDrawer({ appInstanceId })}
                  >
                    <span className="truncate">{t('card.menu.deploy')}</span>
                  </Button>
                )
              : undefined}
          />
        </div>

        <div className="mt-auto flex min-h-11 min-w-0 items-center gap-3 border-t border-divider-subtle px-4 py-2">
          {showFooterCreateReleaseAction
            ? (
                <div className="-ml-2 flex min-w-0 grow items-center">
                  <CreateReleaseControl
                    appInstanceId={appInstanceId}
                    variant="secondary-accent"
                    label={t('card.createFirstRelease')}
                    className="max-w-full"
                  />
                </div>
              )
            : <DeploymentAccessLinks appInstanceId={appInstanceId} access={access} isLoading={accessChannelsIsLoading} />}
          <ReleaseMetaTooltip release={latestRelease} deployed={latestReleaseDeployed}>
            <Link
              href={latestRelease ? getInstanceTabHref(appInstanceId, 'releases') : getInstanceTabHref(appInstanceId, 'instances')}
              className="min-w-0 shrink truncate text-right system-xs-medium text-text-secondary hover:text-text-primary"
            >
              {releaseMeta}
            </Link>
          </ReleaseMetaTooltip>
        </div>
      </div>
    </div>
  )
}
