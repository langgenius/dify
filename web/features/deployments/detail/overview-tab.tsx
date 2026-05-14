'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { SectionState } from './common'
import { EnvironmentStrip, EnvironmentStripSkeleton } from './overview-tab/environment-strip'
import { computeOverviewStats } from './overview-tab/overview-drift'
import { PreviousReleases } from './overview-tab/previous-releases'
import { ReleaseHero, ReleaseHeroSkeleton } from './overview-tab/release-hero'

const OVERVIEW_RELEASE_WINDOW = 20

function OverviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-6 px-6 py-6 2xl:max-w-[1440px]">
      {children}
    </div>
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

  if (overviewQuery.isLoading) {
    return (
      <OverviewLayout>
        <ReleaseHeroSkeleton />
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

  const instance = overviewQuery.data?.overview?.appInstance
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
        <ReleaseHeroSkeleton />
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
      <ReleaseHero
        appInstanceId={appInstanceId}
        latestRelease={latestRelease}
        stats={stats}
      />
      <EnvironmentStrip
        appInstanceId={appInstanceId}
        rows={runtimeRows}
        releaseRows={releaseRows}
        stats={stats}
        isLoading={runtimeInstancesQuery.isLoading}
        isError={runtimeInstancesQuery.isError}
      />
      <PreviousReleases
        appInstanceId={appInstanceId}
        releaseRows={releaseRows}
        stats={stats}
      />
    </OverviewLayout>
  )
}
