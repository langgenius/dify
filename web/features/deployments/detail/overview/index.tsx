'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import { DeploymentStateMessage } from '../../shared/components/empty-state'
import { hasRuntimeInstanceDeployment } from '../../shared/domain/runtime-status'
import { deploymentDetailOverviewQueryAtom } from '../state'
import { AccessStatusSection, AccessStatusSectionSkeleton, ApiTokenSummarySection, ApiTokenSummarySectionSkeleton } from './access-status-section'
import { EnvironmentStrip, EnvironmentStripSkeleton } from './environment-strip'
import { ReleaseHero, ReleaseHeroSkeleton } from './release-hero'

function OverviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-6 py-6">
      {children}
    </div>
  )
}

function LatestReleaseSection({ children }: {
  children: React.ReactNode
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="system-sm-semibold text-text-primary">
          {t('overview.latestReleaseTitle')}
        </h3>
        {appInstanceId && (
          <Link
            href={`/deployments/${appInstanceId}/releases`}
            className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            {t('overview.previousReleases.viewAll')}
            <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
          </Link>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </section>
  )
}

function OverviewLoadingSkeleton() {
  return (
    <OverviewLayout>
      <EnvironmentStripSkeleton />
      <LatestReleaseSection>
        <ReleaseHeroSkeleton />
      </LatestReleaseSection>
      <AccessStatusSectionSkeleton />
      <ApiTokenSummarySectionSkeleton />
    </OverviewLayout>
  )
}

export function DeploymentOverview() {
  const { t } = useTranslation('deployments')
  const overviewQuery = useAtomValue(deploymentDetailOverviewQueryAtom)
  const overview = overviewQuery.data

  if (overviewQuery.isLoading)
    return <OverviewLoadingSkeleton />

  if (overviewQuery.isError) {
    return (
      <OverviewLayout>
        <DeploymentStateMessage variant="section">{t('common.loadFailed')}</DeploymentStateMessage>
      </OverviewLayout>
    )
  }

  if (!overview) {
    return (
      <OverviewLayout>
        <DeploymentStateMessage variant="section">{t('detail.notFound')}</DeploymentStateMessage>
      </OverviewLayout>
    )
  }

  const releaseRows = overview.recentReleases
  // recentReleases is a capped preview; totalReleaseCount is the true total.
  const releaseCount = overview.totalReleaseCount
  const runtimeRows = overview.environmentDeployments
  const deployedEnvironmentCount = runtimeRows.filter(hasRuntimeInstanceDeployment).length
  const latestRelease = releaseRows[0]
  const accessChannels = overview.accessChannels
  const apiKeySummary = overview.apiKeySummary

  return (
    <OverviewLayout>
      <EnvironmentStrip
        rows={runtimeRows}
        releaseRows={releaseRows}
      />
      <LatestReleaseSection>
        <ReleaseHero
          latestRelease={latestRelease}
          releaseCount={releaseCount}
        />
      </LatestReleaseSection>
      <AccessStatusSection accessChannels={accessChannels} />
      <ApiTokenSummarySection
        accessChannels={accessChannels}
        apiKeySummary={apiKeySummary}
        deployedEnvironmentCount={deployedEnvironmentCount}
      />
    </OverviewLayout>
  )
}
