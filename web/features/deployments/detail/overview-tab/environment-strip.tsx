'use client'

import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
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
        <SkeletonRectangle key={key} className="my-0 h-36 animate-pulse rounded-xl" />
      ))}
    </div>
  )
}

export function EnvironmentStripSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SkeletonRectangle className="my-0 h-3 w-44 animate-pulse" />
      <CardSkeletons />
    </section>
  )
}
