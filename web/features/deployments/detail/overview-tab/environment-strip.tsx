'use client'

import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { environmentId } from '../../environment'
import { isUndeployedDeploymentRow } from '../../runtime-status'
import { SectionState } from '../common'
import { EnvironmentTile } from './environment-tile'

type EnvironmentStripProps = {
  appInstanceId: string
  rows: EnvironmentDeployment[]
  releaseRows: ReleaseRow[]
  isLoading: boolean
  isError: boolean
}

export function EnvironmentStrip({ appInstanceId, rows, releaseRows, isLoading, isError }: EnvironmentStripProps) {
  const { t } = useTranslation('deployments')
  const deployedRows = rows.filter(row => !isUndeployedDeploymentRow(row))

  return (
    <section className="flex flex-col gap-3">
      <h3 className="system-sm-semibold text-text-primary">{t('overview.strip.title')}</h3>

      {isLoading
        ? <CardSkeletons />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : rows.length === 0
            ? <SectionState>{t('overview.strip.empty')}</SectionState>
            : deployedRows.length === 0
              ? <SectionState>{t('overview.strip.emptyDeployed')}</SectionState>
              : (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
                    {deployedRows.map(row => (
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

const SKELETON_KEYS = ['a', 'b', 'c', 'd']

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
      className="relative flex min-h-30 min-w-0 flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg p-3.5 shadow-xs"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-text-quaternary opacity-30" />

      <div className="flex min-w-0 items-start justify-between gap-3 pl-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <SkeletonRectangle className="my-0 size-7 shrink-0 animate-pulse rounded-lg" />
          <SkeletonRectangle className="my-0 h-3.5 w-28 animate-pulse" />
        </div>
        <SkeletonRow className="my-0 h-5 shrink-0 gap-1.5 rounded-md bg-text-quaternary px-1.5 opacity-20">
          <span className="size-1.5 shrink-0 rounded-full bg-text-quaternary" />
          <span className="h-2.5 w-8 rounded-xs bg-text-quaternary" />
        </SkeletonRow>
      </div>

      <div className="mt-5 flex min-w-0 items-end justify-between gap-3 pl-1.5">
        <div className="min-w-0">
          <SkeletonRectangle className="my-0 h-2.5 w-20 animate-pulse" />
          <div className="mt-2 flex min-w-0 items-baseline gap-2">
            <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse" />
            <SkeletonRectangle className="my-0 h-5 w-16 animate-pulse rounded-md" />
          </div>
        </div>
        <SkeletonRectangle className="my-0 h-7 w-22 shrink-0 animate-pulse rounded-md" />
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
