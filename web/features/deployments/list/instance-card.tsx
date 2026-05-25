'use client'

import type {
  AccessChannels,
  AppInstance,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactElement } from 'react'
import type { InstanceDetailTabKey } from '../detail/tabs'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { CreateReleaseControl } from '../detail/versions-tab/create-release-control'
import { environmentName } from '../environment'
import { formatDate, releaseLabel } from '../release'
import {
  deploymentStatus,
  deploymentStatusPollingInterval,
  isUndeployedDeploymentRow,
} from '../runtime-status'
import { openDeployDrawerAtom } from '../store'

const VISIBLE_ENVIRONMENT_COUNT = 3
const CARD_RELEASE_QUERY_PAGE_SIZE = 1

function getInstanceTabHref(appInstanceId: string, tabKey: InstanceDetailTabKey) {
  return `/deployments/${appInstanceId}/${tabKey}`
}

function hasEnvironment(row: EnvironmentDeployment) {
  return Boolean(row.environment?.id)
}

function isActiveDeployment(row: EnvironmentDeployment) {
  return hasEnvironment(row) && !isUndeployedDeploymentRow(row)
}

function deploymentChipClasses(row: EnvironmentDeployment) {
  const status = deploymentStatus(row)
  if (status === 'deploy_failed') {
    return {
      container: 'bg-util-colors-red-red-50 text-util-colors-red-red-700',
      dot: 'bg-util-colors-red-red-500',
    }
  }
  if (status === 'deploying') {
    return {
      container: 'bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
      dot: 'bg-util-colors-warning-warning-500 animate-pulse',
    }
  }
  if (status === 'drifted') {
    return {
      container: 'bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
      dot: 'bg-util-colors-warning-warning-500',
    }
  }
  if (status === 'invalid') {
    return {
      container: 'bg-util-colors-red-red-50 text-util-colors-red-red-700',
      dot: 'bg-util-colors-red-red-500',
    }
  }
  if (status === 'ready') {
    return {
      container: 'bg-util-colors-green-green-50 text-util-colors-green-green-700',
      dot: 'bg-util-colors-green-green-500',
    }
  }
  return {
    container: 'bg-background-section-burn text-text-tertiary',
    dot: 'bg-text-quaternary',
  }
}

function statusLabel(row: EnvironmentDeployment, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  const status = deploymentStatus(row)
  if (status === 'deploy_failed')
    return t('status.deployFailed')
  if (status === 'deploying')
    return t('status.deploying')
  if (status === 'ready')
    return t('status.ready')
  if (status === 'drifted')
    return t('status.drifted')
  if (status === 'invalid')
    return t('status.invalid')
  if (status === 'not_deployed')
    return t('status.notDeployed')
  return t('status.unknown')
}

function pickLatestRelease(rows: Release[]): Release | undefined {
  return [...rows].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0
    return bTime - aTime
  })[0]
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
  const classes = deploymentChipClasses(row)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className={cn(
              'inline-flex h-5 max-w-32 cursor-default items-center gap-1 rounded-md px-1.5 system-xs-medium',
              classes.container,
            )}
            title={name}
          >
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', classes.dot)} />
            <span className="truncate">{name}</span>
          </span>
        )}
      />
      <TooltipContent>
        <div className="flex min-w-40 flex-col gap-1">
          <div className="flex justify-between gap-3">
            <span className="truncate text-text-secondary">{name}</span>
            <span className="shrink-0">{statusLabel(row, t)}</span>
          </div>
          {row.currentRelease?.id && (
            <div className="flex justify-between gap-3 text-text-tertiary">
              <span>{t('card.tooltip.release')}</span>
              <span className="font-mono">{releaseLabel(row.currentRelease)}</span>
            </div>
          )}
        </div>
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
          {rows.map(row => (
            <div key={row.environment?.id} className="flex justify-between gap-3">
              <span className="truncate text-text-secondary">{environmentName(row.environment)}</span>
              <span className="shrink-0">{statusLabel(row, t)}</span>
            </div>
          ))}
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
          key: 'api',
          href: getInstanceTabHref(appInstanceId, 'api'),
          label: t('card.access.api'),
          icon: 'i-ri-code-s-slash-line',
        }
      : undefined,
  ].filter((link): link is { key: string, href: string, label: string, icon: string } => Boolean(link))

  if (links.length === 0)
    return <div role="group" aria-label={t('overview.accessStatus')} className="min-w-0 grow" />

  return (
    <div role="group" aria-label={t('overview.accessStatus')} className="flex min-w-0 grow items-center gap-2">
      {links.map(link => (
        <Tooltip key={link.key}>
          <TooltipTrigger
            render={(
              <Link
                href={link.href}
                aria-label={link.label}
                className="inline-flex size-5 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
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

export function InstanceCard({ app }: {
  app: AppInstance
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const appInstanceId = app.id ?? ''
  const appName = app.name ?? appInstanceId
  const detailHref = getInstanceTabHref(appInstanceId, 'overview')
  const input = { params: { appInstanceId } }

  const instanceQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input,
    enabled: Boolean(appInstanceId),
  }))
  const accessChannelsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessChannels.queryOptions({
    input,
    enabled: Boolean(appInstanceId),
  }))
  const releaseHistoryQuery = useQuery(consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: {
      ...input,
      query: {
        pageNumber: 1,
        resultsPerPage: CARD_RELEASE_QUERY_PAGE_SIZE,
      },
    },
    enabled: Boolean(appInstanceId),
  }))
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input,
    enabled: Boolean(appInstanceId),
    refetchInterval: query => deploymentStatusPollingInterval(query.state.data),
  }))

  if (!app.id)
    return null

  const description = (instanceQuery.data?.appInstance?.description ?? app.description)?.trim()
  const access = accessChannelsQuery.data?.accessChannels
  const releaseRows = releaseHistoryQuery.data?.data?.filter((release): release is Release & { id: string } => Boolean(release.id)) ?? []
  const hasRelease = releaseRows.length > 0
  const activeDeploymentRows = environmentDeploymentsQuery.data?.data?.filter(isActiveDeployment) ?? []
  const latestRelease = pickLatestRelease(releaseRows)
  const latestReleaseTime = latestRelease?.createdAt
  const latestReleaseTimeMs = latestReleaseTime ? Date.parse(latestReleaseTime) : Number.NaN
  const latestReleaseDeployed = isReleaseDeployed(latestRelease, activeDeploymentRows)
  const releaseMeta = latestRelease
    ? [
        releaseLabel(latestRelease),
        Number.isNaN(latestReleaseTimeMs) ? undefined : formatTimeFromNow(latestReleaseTimeMs),
      ].filter(Boolean).join(' · ')
    : t('card.notDeployed')
  const statusIsLoading = environmentDeploymentsQuery.isLoading || (!activeDeploymentRows.length && releaseHistoryQuery.isLoading)
  const statusHasError = environmentDeploymentsQuery.isError || releaseHistoryQuery.isError
  const showDeployAction = !statusIsLoading && !statusHasError && hasRelease && activeDeploymentRows.length === 0
  const showFooterCreateReleaseAction = !statusIsLoading && !statusHasError && !hasRelease

  return (
    <div
      className="group relative col-span-1 inline-flex h-40 min-w-0 cursor-default flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-xs transition-all duration-200 ease-in-out hover:shadow-lg"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <Link
          href={detailHref}
          className="block min-w-0 rounded-t-xl px-4 pt-4 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <h3 className="truncate title-md-semi-bold text-text-primary" title={appName}>
            {appName}
          </h3>
          {instanceQuery.isLoading
            ? (
                <div className="mt-2 flex min-h-9 flex-col gap-1.5">
                  <SkeletonRectangle className="my-0 h-3 w-4/5 animate-pulse" />
                  <SkeletonRectangle className="my-0 h-3 w-3/5 animate-pulse" />
                </div>
              )
            : (
                description
                  ? (
                      <p
                        className="mt-2 line-clamp-2 min-h-9 system-xs-regular text-text-tertiary"
                        title={description}
                      >
                        {description}
                      </p>
                    )
                  : <div className="mt-2 min-h-9" />
              )}
        </Link>

        <div role="group" aria-label={t('card.tooltip.deploymentStatus')} className="min-h-7 px-4 pt-1">
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

        <div className="mt-auto flex h-10.5 min-w-0 items-center border-t border-divider-subtle px-4">
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
            : <DeploymentAccessLinks appInstanceId={appInstanceId} access={access} isLoading={accessChannelsQuery.isLoading} />}
          <ReleaseMetaTooltip release={latestRelease} deployed={latestReleaseDeployed}>
            <Link
              href={latestRelease ? getInstanceTabHref(appInstanceId, 'releases') : getInstanceTabHref(appInstanceId, 'instances')}
              className="min-w-0 shrink-0 truncate text-right system-xs-regular text-text-tertiary hover:text-text-secondary"
            >
              {releaseMeta}
            </Link>
          </ReleaseMetaTooltip>
        </div>
      </div>
    </div>
  )
}
