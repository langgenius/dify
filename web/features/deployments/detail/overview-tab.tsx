'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { SectionState } from './common'
import { EnvironmentStrip, EnvironmentStripSkeleton } from './overview-tab/environment-strip'
import { computeOverviewStats } from './overview-tab/overview-drift'
import { PreviousReleases } from './overview-tab/previous-releases'
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
      {sourceAppAvailability.sourceAppUnavailable && <SourceAppDeletedNotice />}
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
