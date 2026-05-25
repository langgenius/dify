'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { OverviewStats } from './overview-drift'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { formatDate, releaseLabel } from '../../release'
import { CreateReleaseControl } from '../versions-tab/create-release-control'
import { OVERVIEW_CARD_CLASS_NAME, OVERVIEW_ICON_CLASS_NAME } from './card-styles'

type ReleaseHeroProps = {
  appInstanceId: string
  latestRelease?: Release
  stats: OverviewStats
}

export function ReleaseHero({ appInstanceId, latestRelease, stats }: ReleaseHeroProps) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const hasRelease = Boolean(latestRelease?.id)
  const author = latestRelease?.createdBy?.name ?? ''
  const ago = latestRelease?.createdAt ? formatTimeFromNow(new Date(latestRelease.createdAt).getTime()) : ''

  const metaParts: { key: string, value: string }[] = []
  if (author)
    metaParts.push({ key: 'author', value: t('overview.hero.byName', { name: author }) })
  if (ago)
    metaParts.push({ key: 'ago', value: ago })
  if (hasRelease && stats.total === 0)
    metaParts.push({ key: 'untargeted', value: t('overview.hero.untargeted') })

  return (
    <div className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className={OVERVIEW_ICON_CLASS_NAME}>
          <span className="i-ri-stack-fill size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="truncate system-xl-semibold text-text-primary">
            {hasRelease ? releaseLabel(latestRelease) : t('overview.hero.empty')}
          </h2>
          {hasRelease
            ? metaParts.length > 0
              ? (
                  <p
                    className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 system-sm-regular text-text-tertiary"
                    title={latestRelease?.createdAt ? formatDate(latestRelease.createdAt) : undefined}
                  >
                    {metaParts.map((part, index) => (
                      <span key={part.key} className="inline-flex items-baseline gap-1.5">
                        {index > 0 && <span aria-hidden className="text-text-quaternary">·</span>}
                        <span>{part.value}</span>
                      </span>
                    ))}
                  </p>
                )
              : null
            : (
                <p className="max-w-[640px] system-sm-regular text-text-tertiary">
                  {t('overview.hero.emptyDescription')}
                </p>
              )}
        </div>
      </div>
      <div className="shrink-0">
        <CreateReleaseControl appInstanceId={appInstanceId} size="medium" />
      </div>
    </div>
  )
}

export function ReleaseHeroSkeleton() {
  return (
    <div
      data-slot="deployment-overview-release-hero-skeleton"
      className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6')}
    >
      <div className="flex min-w-0 items-start gap-3">
        <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <SkeletonRectangle className="my-0 h-6 w-40 animate-pulse" />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <SkeletonRectangle className="my-0 h-3 w-32 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-14 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-28 animate-pulse" />
          </div>
        </div>
      </div>
      <div className="shrink-0">
        <SkeletonRectangle className="my-0 h-9 w-32 animate-pulse rounded-lg" />
      </div>
    </div>
  )
}
