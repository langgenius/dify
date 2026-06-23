'use client'

import type {
  AccessChannels,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactElement } from 'react'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { formatDate } from '../../shared/domain/release'
import { EnvironmentDeploymentBadge } from '../../shared/ui/deployment-status-badge'
import { deploymentStatusLabelKey } from '../../shared/ui/deployment-status-style'
import { getInstanceTabHref } from './instance-card-utils'

const VISIBLE_ENVIRONMENT_COUNT = 3

function releaseSourceLabel(release: Release | undefined, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  if (release?.source === ReleaseSource.RELEASE_SOURCE_SOURCE_APP || release?.sourceAppId)
    return t('versions.sourceAppOption')
  if (release?.source === ReleaseSource.RELEASE_SOURCE_UPLOAD)
    return t('versions.manualDslOption')
  return '—'
}

export function ReleaseMetaTooltip({ release, deployed, children }: {
  release?: Release
  deployed: boolean
  children: ReactElement
}) {
  const { t } = useTranslation('deployments')

  if (!release)
    return children

  const rows = [
    { label: t('card.tooltip.releaseName'), value: release.displayName },
    { label: t('card.tooltip.deploymentStatus'), value: deployed ? t('card.tooltip.deployed') : t('card.tooltip.notDeployedShort') },
    { label: t('card.tooltip.source'), value: releaseSourceLabel(release, t) },
    { label: t('card.tooltip.createdAt'), value: formatDate(release.createdAt) },
  ]

  return (
    <PreviewCard>
      <PreviewCardTrigger render={children} />
      <PreviewCardContent popupClassName="px-3 py-2">
        <div className="flex min-w-48 flex-col gap-1 system-xs-regular">
          {rows.map(row => (
            <div key={row.label} className="flex justify-between gap-4">
              <span className="shrink-0 text-text-tertiary">{row.label}</span>
              <span className="min-w-0 truncate text-right text-text-secondary">{row.value}</span>
            </div>
          ))}
        </div>
      </PreviewCardContent>
    </PreviewCard>
  )
}

function EnvironmentChip({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const name = row.environment.displayName
  const status = row.status
  const statusLabel = t(deploymentStatusLabelKey(status))
  const tooltipSummary = [
    name,
    row.currentRelease ? row.currentRelease.displayName : undefined,
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
    <Popover>
      <PopoverTrigger
        render={(
          <button
            type="button"
            className="inline-flex h-5 cursor-pointer items-center rounded-md bg-background-section-burn px-1.5 system-xs-medium text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {t('card.envOverflow', { count: rows.length })}
          </button>
        )}
      />
      <PopoverContent popupClassName="px-3 py-2">
        <div className="flex min-w-40 flex-col gap-1">
          {rows.map((row) => {
            const status = row.status
            const summary = [
              row.environment.displayName,
              row.currentRelease ? row.currentRelease.displayName : undefined,
              t(deploymentStatusLabelKey(status)),
            ].filter(Boolean).join(' · ')

            return (
              <span key={row.environment.id} className="whitespace-nowrap text-text-secondary">{summary}</span>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function DeploymentStatusContent({
  rows,
  emptyAction,
}: {
  rows: EnvironmentDeployment[]
  emptyAction?: ReactElement
}) {
  const visibleRows = rows.slice(0, VISIBLE_ENVIRONMENT_COUNT)
  const overflowRows = rows.slice(VISIBLE_ENVIRONMENT_COUNT)

  if (rows.length > 0) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleRows.map(row => (
          <EnvironmentChip key={row.environment.id} row={row} />
        ))}
        {overflowRows.length > 0 && <EnvironmentOverflow rows={overflowRows} />}
      </div>
    )
  }

  if (emptyAction)
    return <div className="flex min-w-0 items-center">{emptyAction}</div>

  return null
}

export function DeploymentAccessLinks({ appInstanceId, access, isLoading }: {
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
    ...(access?.webAppEnabled
      ? [{
          key: 'webapp',
          href: getInstanceTabHref(appInstanceId, 'access'),
          label: t('card.access.webApp'),
          icon: 'i-ri-global-line',
        }]
      : []),
    ...(access?.webAppEnabled
      ? [{
          key: 'cli',
          href: getInstanceTabHref(appInstanceId, 'access'),
          label: t('card.access.cli'),
          icon: 'i-ri-terminal-box-line',
        }]
      : []),
    ...(access?.developerApiEnabled
      ? [{
          key: 'api-tokens',
          href: getInstanceTabHref(appInstanceId, 'api-tokens'),
          label: t('card.access.api'),
          icon: 'i-ri-code-s-slash-line',
        }]
      : []),
  ]

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
