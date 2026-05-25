'use client'

import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { environmentId } from '../../environment'
import { hasRuntimeInstanceDeployment } from '../../runtime-status'
import { SectionState } from '../common'
import { OVERVIEW_CARD_CLASS_NAME } from './card-styles'
import { EnvironmentTile } from './environment-tile'

const OVERVIEW_RUNTIME_INSTANCE_LIMIT = 3

type EnvironmentStripProps = {
  appInstanceId: string
  rows: EnvironmentDeployment[]
  releaseRows: Release[]
  isLoading: boolean
  isError: boolean
}

export function EnvironmentStrip({ appInstanceId, rows, releaseRows, isLoading, isError }: EnvironmentStripProps) {
  const { t } = useTranslation('deployments')
  const runtimeRows = rows.filter(hasRuntimeInstanceDeployment)
  const previewRows = runtimeRows.slice(0, OVERVIEW_RUNTIME_INSTANCE_LIMIT)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">{t('overview.strip.title')}</h3>

      {isLoading
        ? <CardSkeletons />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : rows.length === 0
            ? <SectionState>{t('overview.strip.empty')}</SectionState>
            : runtimeRows.length === 0
              ? <SectionState>{t('overview.strip.emptyDeployed')}</SectionState>
              : (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
                    {previewRows.map(row => (
                      <EnvironmentTile
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

const SKELETON_KEYS = ['a', 'b', 'c']

function CardSkeletons() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
      {SKELETON_KEYS.map(key => (
        <EnvironmentTileSkeleton key={key} />
      ))}
    </div>
  )
}

function EnvironmentTileSkeleton() {
  return (
    <article
      data-slot="deployment-overview-environment-tile-skeleton"
      className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-h-28 min-w-0 flex-col justify-between gap-4')}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-lg" />
          <SkeletonRectangle className="my-0 h-3.5 w-28 animate-pulse" />
        </div>
        <SkeletonRow className="my-0 h-6 shrink-0 gap-1.5 rounded-md bg-background-section-burn px-2">
          <span className="size-1.5 shrink-0 rounded-full bg-text-quaternary" />
          <span className="h-2.5 w-8 rounded-xs bg-text-quaternary opacity-20" />
        </SkeletonRow>
      </div>

      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <SkeletonRectangle className="my-0 h-2.5 w-20 animate-pulse" />
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <SkeletonRectangle className="my-0 h-3.5 w-24 animate-pulse" />
            <SkeletonRectangle className="my-0 h-5 w-16 animate-pulse rounded" />
          </div>
        </div>
        <SkeletonRectangle className="my-0 h-8 w-22 shrink-0 animate-pulse rounded-md" />
      </div>
    </article>
  )
}

export function EnvironmentStripSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <section className="flex flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">{t('overview.strip.title')}</h3>
      <CardSkeletons />
    </section>
  )
}
