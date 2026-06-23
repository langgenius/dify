'use client'

import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from '#i18n'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { openDeployDrawerAtom } from '../../../deploy-drawer/state'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { DeploymentEmptyState } from '../../../shared/components/empty-state'
import { hasRuntimeInstanceDeployment } from '../../../shared/domain/runtime-status'
import { EnvironmentTile } from './environment-tile'

const OVERVIEW_RUNTIME_INSTANCE_LIMIT = 4
const OVERVIEW_CARD_CLASS_NAME = 'rounded-xl border border-components-panel-border bg-components-panel-bg p-4'

type EnvironmentStripProps = {
  rows: EnvironmentDeployment[]
  releaseRows: Release[]
}

export function EnvironmentStrip({ rows, releaseRows }: EnvironmentStripProps) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const runtimeRows = rows.filter(hasRuntimeInstanceDeployment)
  const previewRows = runtimeRows.slice(0, OVERVIEW_RUNTIME_INSTANCE_LIMIT)
  const hasRuntimeRows = runtimeRows.length > 0
  const hasRelease = releaseRows.length > 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="system-sm-semibold text-text-primary">{t('overview.strip.title')}</h3>
        {hasRuntimeRows && appInstanceId && (
          <Link
            href={`/deployments/${appInstanceId}/instances`}
            className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            {t('overview.previousReleases.viewAll')}
            <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
          </Link>
        )}
      </div>

      {!hasRuntimeRows
        ? <EnvironmentEmptyState canDeploy={hasRelease} />
        : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3">
              {previewRows.map(row => (
                <EnvironmentTile
                  key={row.environment.id}
                  row={row}
                  releaseRows={releaseRows}
                />
              ))}
            </div>
          )}
    </section>
  )
}

function EnvironmentEmptyState({ canDeploy }: {
  canDeploy: boolean
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)

  return (
    <DeploymentEmptyState
      variant="section"
      icon="i-ri-server-line"
      title={t('overview.strip.emptyTitle')}
      description={canDeploy ? t('overview.strip.emptyDeployableDescription') : t('overview.strip.emptyDescription')}
      className="min-h-44"
      action={canDeploy && appInstanceId
        ? (
            <Button
              type="button"
              variant="primary"
              size="medium"
              className="gap-1.5"
              onClick={() => openDeployDrawer({ appInstanceId })}
            >
              <span className="i-ri-rocket-line size-4 shrink-0" aria-hidden="true" />
              {t('overview.strip.deployToNewEnvironment')}
            </Button>
          )
        : undefined}
    />
  )
}

const SKELETON_KEYS = ['a', 'b', 'c']

function CardSkeletons() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3">
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
