'use client'

import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import type { OverviewStats } from './overview-drift'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { environmentId } from '../../environment'
import { SectionState } from '../common'
import { EnvironmentChip } from './environment-chip'

type EnvironmentStripProps = {
  appInstanceId: string
  rows: EnvironmentDeployment[]
  releaseRows: ReleaseRow[]
  stats: OverviewStats
  isLoading: boolean
  isError: boolean
}

export function EnvironmentStrip({ appInstanceId, rows, releaseRows, stats, isLoading, isError }: EnvironmentStripProps) {
  const { t } = useTranslation('deployments')
  const onLatest = stats.ready
  const showSummary = stats.total > 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="system-sm-semibold text-text-primary">{t('overview.strip.title')}</h3>
        {showSummary && (
          <>
            <span aria-hidden className="text-text-quaternary">·</span>
            <span className="system-xs-regular text-text-tertiary">
              {t('overview.strip.summary', { count: onLatest, total: stats.total })}
            </span>
          </>
        )}
      </div>

      {stats.failed > 0 && <FailureBanner appInstanceId={appInstanceId} failedCount={stats.failed} t={t} />}

      {isLoading
        ? <ChipSkeletons />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : rows.length === 0
            ? <SectionState>{t('overview.strip.empty')}</SectionState>
            : (
                <div className="flex flex-wrap gap-2">
                  {rows.map(row => (
                    <EnvironmentChip
                      key={environmentId(row.environment)}
                      appInstanceId={appInstanceId}
                      row={row}
                      releaseRows={releaseRows}
                    />
                  ))}
                </div>
              )}
    </section>
  )
}

function FailureBanner({ appInstanceId, failedCount, t }: {
  appInstanceId: string
  failedCount: number
  t: ReturnType<typeof useTranslation<'deployments'>>['t']
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-sm-regular text-util-colors-red-red-700">
      <span aria-hidden className="i-ri-error-warning-fill size-4 shrink-0" />
      <span className="min-w-0 grow truncate">
        {t('overview.strip.failedAlert', { count: failedCount })}
      </span>
      <Link
        href={`/deployments/${appInstanceId}/deploy`}
        className="shrink-0 system-xs-medium underline-offset-2 hover:underline"
      >
        {t('overview.strip.investigate')}
      </Link>
    </div>
  )
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd']

function ChipSkeletons() {
  return (
    <div className="flex flex-wrap gap-2">
      {SKELETON_KEYS.map(key => (
        <SkeletonRectangle key={key} className="my-0 h-7 w-32 animate-pulse rounded-full" />
      ))}
    </div>
  )
}

export function EnvironmentStripSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SkeletonRectangle className="my-0 h-3 w-44 animate-pulse" />
      <ChipSkeletons />
    </section>
  )
}
