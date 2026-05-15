'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { SectionState } from './common'
import { EnvironmentStrip, EnvironmentStripSkeleton } from './overview-tab/environment-strip'
import { computeOverviewStats } from './overview-tab/overview-drift'
import { ReleaseHero, ReleaseHeroSkeleton } from './overview-tab/release-hero'
import { useSourceAppAvailability } from './source-app-availability'

const OVERVIEW_RELEASE_WINDOW = 20

function OverviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-6 px-6 py-6 2xl:max-w-[1440px]">
      {children}
    </div>
  )
}

function SourceAppDeletedNotice() {
  const { t } = useTranslation('deployments')

  return (
    <section
      role="status"
      className="flex items-start gap-3 rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-4 py-3 text-util-colors-warning-warning-700"
    >
      <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0" />
      <div className="min-w-0">
        <div className="system-sm-semibold text-util-colors-warning-warning-700">
          {t('overview.sourceAppDeletedTitle')}
        </div>
        <p className="mt-1 system-sm-regular text-util-colors-warning-warning-700">
          {t('overview.sourceAppDeletedDescription')}
        </p>
      </div>
    </section>
  )
}

function ReleaseOverviewSection({ appInstanceId, children }: {
  appInstanceId: string
  children: React.ReactNode
}) {
  const { t } = useTranslation('deployments')

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="system-sm-semibold text-text-primary">
          {t('overview.recentReleases')}
        </h3>
        <Link
          href={`/deployments/${appInstanceId}/releases`}
          className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary transition-colors hover:text-text-secondary"
        >
          {t('overview.previousReleases.viewAll')}
          <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
        </Link>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {children}
      </div>
    </section>
  )
}

export function OverviewTab({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const input = { params: { appInstanceId } }
  const overviewQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({ input }))
  const runtimeInstancesQuery = useQuery(consoleQuery.enterprise.appDeploymentService.listEnvironmentDeployments.queryOptions({ input }))
  const releasesQuery = useQuery(consoleQuery.enterprise.appReleaseService.listReleases.queryOptions({
    input: {
      params: { appInstanceId },
      query: { pageNumber: 1, resultsPerPage: OVERVIEW_RELEASE_WINDOW },
    },
  }))
  const instance = overviewQuery.data?.overview?.appInstance
  const sourceAppAvailability = useSourceAppAvailability(instance)

  if (overviewQuery.isLoading) {
    return (
      <OverviewLayout>
        <ReleaseOverviewSection appInstanceId={appInstanceId}>
          <ReleaseHeroSkeleton />
        </ReleaseOverviewSection>
      </OverviewLayout>
    )
  }

  if (overviewQuery.isError) {
    return (
      <OverviewLayout>
        <SectionState>{t('common.loadFailed')}</SectionState>
      </OverviewLayout>
    )
  }

  if (!instance?.id) {
    return (
      <OverviewLayout>
        <SectionState>{t('detail.notFound')}</SectionState>
      </OverviewLayout>
    )
  }

  if (releasesQuery.isLoading) {
    return (
      <OverviewLayout>
        {sourceAppAvailability.sourceAppUnavailable && <SourceAppDeletedNotice />}
        <ReleaseOverviewSection appInstanceId={appInstanceId}>
          <ReleaseHeroSkeleton />
        </ReleaseOverviewSection>
        <EnvironmentStripSkeleton />
      </OverviewLayout>
    )
  }

  if (releasesQuery.isError) {
    return (
      <OverviewLayout>
        <SectionState>{t('common.loadFailed')}</SectionState>
      </OverviewLayout>
    )
  }

  const releaseRows = releasesQuery.data?.data ?? []
  const runtimeRows = runtimeInstancesQuery.data?.data?.filter(row => row.environment?.id) ?? []
  const latestRelease = releaseRows[0]
  const stats = computeOverviewStats(runtimeRows, releaseRows)

  return (
    <OverviewLayout>
      {sourceAppAvailability.sourceAppUnavailable && <SourceAppDeletedNotice />}
      <div className="flex min-w-0 flex-col gap-6">
        <ReleaseOverviewSection appInstanceId={appInstanceId}>
          <ReleaseHero
            appInstanceId={appInstanceId}
            latestRelease={latestRelease}
            stats={stats}
          />
        </ReleaseOverviewSection>
        <EnvironmentStrip
          appInstanceId={appInstanceId}
          rows={runtimeRows}
          releaseRows={releaseRows}
          stats={stats}
          isLoading={runtimeInstancesQuery.isLoading}
          isError={runtimeInstancesQuery.isError}
        />
      </div>
    </OverviewLayout>
  )
}
