'use client'

import type { ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import type { OverviewStats } from './overview-drift'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { formatDate, releaseLabel } from '../../release'
import { CreateReleaseControl } from '../versions-tab/create-release-control'

type ReleaseHeroProps = {
  appInstanceId: string
  latestRelease?: ReleaseRow
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
  if (stats.total > 0)
    metaParts.push({ key: 'propagation', value: t('overview.hero.propagation', { count: stats.ready, total: stats.total }) })
  else if (hasRelease)
    metaParts.push({ key: 'untargeted', value: t('overview.hero.untargeted') })

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-components-panel-border bg-components-panel-bg p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        {hasRelease
          ? (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700"
                  >
                    <span className="i-ri-stack-fill size-5" />
                  </span>
                  <h2 className="truncate font-mono text-2xl font-semibold text-text-primary">
                    {releaseLabel(latestRelease)}
                  </h2>
                </div>
                {metaParts.length > 0 && (
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
                )}
              </>
            )
          : (
              <>
                <h2 className="system-xl-semibold text-text-primary">
                  {t('overview.hero.empty')}
                </h2>
                <p className="max-w-[640px] system-sm-regular text-text-tertiary">
                  {t('overview.hero.emptyDescription')}
                </p>
              </>
            )}
      </div>
      <div className="shrink-0">
        <CreateReleaseControl appInstanceId={appInstanceId} size="medium" />
      </div>
    </div>
  )
}

export function ReleaseHeroSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-components-panel-border bg-components-panel-bg p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3">
        <SkeletonRectangle className="my-0 h-7 w-40 animate-pulse" />
        <SkeletonRectangle className="my-0 h-3 w-60 animate-pulse" />
      </div>
      <SkeletonRectangle className="my-0 h-9 w-32 animate-pulse rounded-lg" />
    </div>
  )
}
