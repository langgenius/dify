'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { DeploymentEmptyState } from '../../components/empty-state'
import { TitleTooltip } from '../../components/title-tooltip'
import { CreateReleaseControl } from '../../create-release'
import { formatDate, releaseCommit } from '../../shared/domain/release'
import {
  deploymentSourceAppIdAtom,
  deploymentSourceAppQueryAtom,
} from '../state'
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

  if (!latestRelease) {
    return (
      <DeploymentEmptyState
        variant="section"
        icon="i-ri-stack-line"
        title={t('overview.hero.empty')}
        description={t('overview.hero.emptyDescription')}
        action={<CreateReleaseControl appInstanceId={appInstanceId} size="medium" />}
        className="min-h-44"
      />
    )
  }

  const author = latestRelease.createdBy.displayName
  const ago = formatTimeFromNow(new Date(latestRelease.createdAt).getTime())
  const createdAtTitle = formatDate(latestRelease.createdAt)
  const commit = releaseCommit(latestRelease)

  return (
    <div className={cn(OVERVIEW_CARD_CLASS_NAME, 'flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={OVERVIEW_ICON_CLASS_NAME}>
          <span className="i-ri-stack-fill size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="truncate system-sm-semibold text-text-primary">
              {latestRelease.displayName}
            </h4>
            {commit !== '—' && (
              <TitleTooltip content={t('versions.commitTooltip', { commit })}>
                <span className="shrink-0 rounded bg-background-section-burn px-1.5 py-0.5 font-mono system-xs-regular text-text-tertiary">
                  {commit}
                </span>
              </TitleTooltip>
            )}
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 system-xs-regular text-text-tertiary">
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
                <TitleTooltip content={createdAtTitle}>
                  <span>
                    {ago}
                  </span>
                </TitleTooltip>
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

  if (!sourceAppId) {
    return (
      <span>
        {release.source === ReleaseSource.RELEASE_SOURCE_UPLOAD ? t('versions.manualDslOption') : '—'}
      </span>
    )
  }

  return (
    <ScopeProvider
      key={sourceAppId}
      atoms={[
        [deploymentSourceAppIdAtom, sourceAppId],
      ]}
      name="DeploymentLatestReleaseSource"
    >
      <LatestReleaseSourceLink sourceAppId={sourceAppId} />
    </ScopeProvider>
  )
}

function LatestReleaseSourceLink({ sourceAppId }: {
  sourceAppId: string
}) {
  const sourceAppQuery = useAtomValue(deploymentSourceAppQueryAtom)
  const sourceAppName = sourceAppQuery.data?.name
  const label = sourceAppName || sourceAppId
  const title = sourceAppName ? `${sourceAppName} (${sourceAppId})` : sourceAppId

  return (
    <TitleTooltip content={title}>
      <Link
        href={`/app/${encodeURIComponent(sourceAppId)}/workflow`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full min-w-0 items-center gap-1 text-text-secondary transition-colors hover:text-text-accent"
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="i-ri-arrow-right-up-line size-3.5 shrink-0" aria-hidden="true" />
      </Link>
    </TitleTooltip>
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
