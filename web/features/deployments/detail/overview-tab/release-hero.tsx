'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { formatDate, releaseCommit, releaseLabel } from '../../release'
import { DetailEmptyState } from '../common'
import { CreateReleaseControl } from '../versions-tab/create-release-control'
import { OVERVIEW_CARD_CLASS_NAME, OVERVIEW_ICON_CLASS_NAME } from './card-styles'

type ReleaseHeroProps = {
  appInstanceId: string
  latestRelease?: Release
  releaseCount: number
}

type ReleaseMetaItemProps = {
  label?: string
  showSeparator?: boolean
  children: ReactNode
}

export function ReleaseHero({ appInstanceId, latestRelease, releaseCount }: ReleaseHeroProps) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const author = latestRelease?.createdBy?.name ?? ''
  const ago = latestRelease?.createdAt ? formatTimeFromNow(new Date(latestRelease.createdAt).getTime()) : ''
  const commit = releaseCommit(latestRelease)

  if (!latestRelease?.id) {
    return (
      <DetailEmptyState
        variant="section"
        icon="i-ri-stack-line"
        title={t('overview.hero.empty')}
        description={t('overview.hero.emptyDescription')}
        action={<CreateReleaseControl appInstanceId={appInstanceId} size="medium" />}
        className="min-h-44"
      />
    )
  }

  return (
    <div className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={OVERVIEW_ICON_CLASS_NAME}>
          <span className="i-ri-stack-fill size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="truncate system-sm-semibold text-text-primary">
              {releaseLabel(latestRelease)}
            </h4>
            {commit !== '—' && (
              <span
                title={t('versions.commitTooltip', { commit })}
                className="shrink-0 rounded bg-background-section-burn px-1.5 py-0.5 font-mono system-xs-regular text-text-tertiary"
              >
                {commit}
              </span>
            )}
          </div>
          <p
            className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 system-xs-regular text-text-tertiary"
            title={latestRelease?.createdAt ? formatDate(latestRelease.createdAt) : undefined}
          >
            <ReleaseMetaItem label={t('versions.col.sourceApp')} showSeparator={false}>
              <LatestReleaseSource release={latestRelease} />
            </ReleaseMetaItem>
            {author && (
              <ReleaseMetaItem>
                {t('overview.hero.byName', { name: author })}
              </ReleaseMetaItem>
            )}
            {ago && (
              <ReleaseMetaItem>
                {ago}
              </ReleaseMetaItem>
            )}
            <ReleaseMetaItem>
              {t('overview.latestRelease.releaseCount', { count: releaseCount })}
            </ReleaseMetaItem>
          </p>
        </div>
      </div>
    </div>
  )
}

function ReleaseMetaItem({ label, showSeparator = true, children }: ReleaseMetaItemProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {showSeparator && (
        <span aria-hidden className="text-text-quaternary">·</span>
      )}
      {label && (
        <span className="shrink-0 text-text-quaternary">{label}</span>
      )}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

function LatestReleaseSource({ release }: {
  release: Release
}) {
  const { t } = useTranslation('deployments')
  const sourceAppId = release.sourceAppId
  const sourceAppQuery = useQuery(consoleQuery.apps.byAppId.get.queryOptions({
    input: {
      params: { app_id: sourceAppId ?? '' },
    },
    enabled: Boolean(sourceAppId),
  }))

  if (!sourceAppId) {
    return (
      <span>
        {release.source === 'RELEASE_SOURCE_UPLOAD' ? t('versions.manualDslOption') : '—'}
      </span>
    )
  }

  const sourceAppName = sourceAppQuery.data?.name
  const label = sourceAppName || sourceAppId
  const title = sourceAppName ? `${sourceAppName} (${sourceAppId})` : sourceAppId

  return (
    <Link
      href={`/app/${encodeURIComponent(sourceAppId)}/workflow`}
      title={title}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full min-w-0 items-center gap-1 text-text-secondary transition-colors hover:text-text-accent"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="i-ri-arrow-right-up-line size-3.5 shrink-0" aria-hidden="true" />
    </Link>
  )
}

export function ReleaseHeroSkeleton() {
  return (
    <div
      data-slot="deployment-overview-release-hero-skeleton"
      className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-w-0 items-start gap-3')}
    >
      <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-lg" />
      <div className="flex min-w-0 flex-col gap-2">
        <SkeletonRectangle className="my-0 h-4 w-40 animate-pulse" />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <SkeletonRectangle className="my-0 h-3 w-32 animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-14 animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-28 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
