'use client'

import type {
  AppPagination,
  AppPartial,
  GetAppsData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { RefObject } from 'react'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InfiniteScrollSentinel } from '@/app/components/base/infinite-scroll-sentinel'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { AppCard } from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import { APP_LIST_GRID_CLASS_NAME } from './constants'
import Empty from './empty'
import FirstEmptyState from './first-empty-state'
import { useAppListTour } from './hooks/use-app-list-tour'
import { useWorkflowOnlineUsers } from './hooks/use-workflow-online-users'
import { StarredAppList } from './starred-app-list'

const STARRED_APP_LIMIT = 100
const STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT = 4
const emptyStarredApps: AppPartial[] = []

const getPreloadDistance = (scrollContainer: Element) =>
  Math.max(160, Math.min(scrollContainer.clientHeight * 0.25, 320))

type AppListQuery = NonNullable<GetAppsData['query']>

type AppListCatalogProps = Readonly<{
  appListQuery: AppListQuery
  canCreateApp: boolean
  dragging: boolean
  hasActiveFilters: boolean
  onCreateBlank: () => void
  onCreateLearnDify?: (app: App) => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  onOpenTagManagement: () => void
  onTryLearnDify?: (params: TryAppSelection) => void
  scrollViewportRef: RefObject<HTMLDivElement | null>
}>

type AppListCatalogContentProps = Omit<AppListCatalogProps, 'appListQuery'> &
  Readonly<{
    appListPages: AppPagination[]
    hasNextPage: boolean
    isFetchNextPageError: boolean
    isFetching: boolean
    isFetchingNextPage: boolean
    isPlaceholderData: boolean
    onFetchNextPage: () => Promise<unknown>
    starredApps: AppPartial[]
    systemFeatures: GetSystemFeaturesResponse
  }>

function CatalogSkeleton() {
  const { t } = useTranslation()

  return (
    <div
      className={`relative grow content-start ${APP_LIST_GRID_CLASS_NAME}`}
      role="status"
      aria-label={t(($) => $.loading, { ns: 'common' })}
    >
      <AppCardSkeleton count={6} />
    </div>
  )
}

function AppListCatalogContent({
  appListPages,
  canCreateApp,
  dragging,
  hasActiveFilters,
  hasNextPage,
  isFetchNextPageError,
  isFetching,
  isFetchingNextPage,
  isPlaceholderData,
  onCreateBlank,
  onCreateLearnDify,
  onCreateTemplate,
  onFetchNextPage,
  onImportDSL,
  onOpenTagManagement,
  onTryLearnDify,
  starredApps,
  scrollViewportRef,
  systemFeatures,
}: AppListCatalogContentProps) {
  const { t } = useTranslation()

  const apps = useMemo(() => appListPages.flatMap(({ data: pageApps }) => pageApps), [appListPages])
  const workflowOnlineUserAppIds = useMemo(() => {
    const appIds = new Set<string>()
    apps.forEach((app) => {
      if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
        appIds.add(app.id)
    })
    return Array.from(appIds)
  }, [apps])

  const { onlineUsersMap: workflowOnlineUsersMap } = useWorkflowOnlineUsers({
    appIds: workflowOnlineUserAppIds,
    enabled: systemFeatures.enable_collaboration_mode,
  })

  const hasResolvedFirstPage = appListPages.length > 0
  const hasAnyApp = (appListPages[0]?.total ?? 0) > 0
  const showFirstEmptyState =
    !isPlaceholderData && !hasAnyApp && canCreateApp && hasResolvedFirstPage && !hasActiveFilters
  const showNoCreateEmptyState =
    !isPlaceholderData && !hasAnyApp && !canCreateApp && hasResolvedFirstPage && !hasActiveFilters
  const { shouldHighlightAllAppsRow, shouldHighlightStarredAppRow, shouldOpenFirstAppActionMenu } =
    useAppListTour({
      canCreateApp,
      hasAnyApp,
      hasResolvedFirstPage,
      hasStarredApps: starredApps.length > 0,
      showFirstEmptyState,
      showNoCreateEmptyState,
    })

  return (
    <>
      {showFirstEmptyState ? (
        <FirstEmptyState
          onCreateBlank={onCreateBlank}
          onCreateLearnDify={onCreateLearnDify}
          onCreateTemplate={onCreateTemplate}
          onImportDSL={onImportDSL}
          onTryLearnDify={onTryLearnDify}
          showLearnDify={systemFeatures.enable_learn_app}
        />
      ) : (
        <>
          {starredApps.length > 0 && (
            <StarredAppList
              apps={starredApps}
              stepByStepTourCardTarget={
                shouldHighlightStarredAppRow
                  ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
                  : undefined
              }
              stepByStepTourCardHighlightPart={
                shouldHighlightStarredAppRow
                  ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard
                  : undefined
              }
              stepByStepTourHighlightedCardCount={
                shouldHighlightStarredAppRow ? STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT : 0
              }
            />
          )}
          <div
            className={cn(
              `relative grow content-start ${APP_LIST_GRID_CLASS_NAME}`,
              !hasAnyApp && 'overflow-hidden',
            )}
          >
            {hasAnyApp ? (
              apps.map((app, index) => (
                <AppCard
                  key={app.id}
                  app={app}
                  onlineUsers={workflowOnlineUsersMap[app.id]}
                  onOpenTagManagement={onOpenTagManagement}
                  stepByStepTourActionMenuOpen={
                    index === 0 ? shouldOpenFirstAppActionMenu : undefined
                  }
                  stepByStepTourCardTarget={
                    index === 0
                      ? shouldHighlightAllAppsRow
                        ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
                        : canCreateApp
                          ? STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard
                          : undefined
                      : undefined
                  }
                  stepByStepTourCardHighlightPart={
                    index < STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT && shouldHighlightAllAppsRow
                      ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard
                      : undefined
                  }
                  stepByStepTourActionMenuHighlightPart={
                    index === 0 && shouldOpenFirstAppActionMenu
                      ? STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu
                      : undefined
                  }
                />
              ))
            ) : (
              <Empty
                stepByStepTourTarget={
                  showNoCreateEmptyState ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateEmpty : undefined
                }
              />
            )}
            {hasNextPage && (
              <div className="relative col-span-full">
                <InfiniteScrollSentinel
                  canLoadMore={!isFetching && !isFetchNextPageError}
                  onLoadMore={() => {
                    void onFetchNextPage()
                  }}
                  preloadDistance={getPreloadDistance}
                  scrollContainerRef={scrollViewportRef}
                />
                <div className="relative grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-2.5">
                  <AppCardSkeleton count={3} />
                  {isFetchNextPageError && (
                    <div
                      className="absolute inset-0 flex items-center justify-center gap-2 bg-background-body system-xs-regular text-text-tertiary"
                      role="alert"
                    >
                      <span>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</span>
                      <Button
                        loading={isFetchingNextPage}
                        size="small"
                        variant="secondary"
                        onClick={() => void onFetchNextPage()}
                      >
                        {t(($) => $['operation.retry'], { ns: 'common' })}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {canCreateApp && !showFirstEmptyState && (
        <div
          className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}
          role="region"
          aria-label={t(($) => $['newApp.dropDSLToCreateApp'], { ns: 'app' })}
        >
          <span className="i-ri-drag-drop-line size-4" />
          <span className="system-xs-regular">
            {t(($) => $['newApp.dropDSLToCreateApp'], { ns: 'app' })}
          </span>
        </div>
      )}
    </>
  )
}

export function AppListCatalog(props: AppListCatalogProps) {
  const {
    appListQuery,
    canCreateApp,
    dragging,
    hasActiveFilters,
    onCreateBlank,
    onCreateLearnDify,
    onCreateTemplate,
    onImportDSL,
    onOpenTagManagement,
    onTryLearnDify,
    scrollViewportRef,
  } = props
  const systemFeaturesQuery = useQuery(systemFeaturesQueryOptions())
  const systemFeatures = systemFeaturesQuery.data
  const appList = useInfiniteQuery(
    consoleQuery.apps.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          ...appListQuery,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
      refetchInterval: systemFeatures?.enable_collaboration_mode ? 10000 : false,
    }),
  )
  const starredAppList = useQuery(
    consoleQuery.apps.starred.get.queryOptions({
      input: {
        query: {
          ...appListQuery,
          page: 1,
          limit: STARRED_APP_LIMIT,
        },
      },
      placeholderData: keepPreviousData,
    }),
  )

  if (systemFeatures === undefined && systemFeaturesQuery.error) throw systemFeaturesQuery.error
  if (appList.data === undefined && appList.error) throw appList.error

  if (
    systemFeatures === undefined ||
    appList.data === undefined ||
    (starredAppList.data === undefined && !starredAppList.error)
  )
    return <CatalogSkeleton />

  return (
    <AppListCatalogContent
      appListPages={appList.data.pages}
      canCreateApp={canCreateApp}
      dragging={dragging}
      hasActiveFilters={hasActiveFilters}
      hasNextPage={appList.hasNextPage}
      isFetchNextPageError={appList.isFetchNextPageError}
      isFetching={appList.isFetching}
      isFetchingNextPage={appList.isFetchingNextPage}
      isPlaceholderData={appList.isPlaceholderData}
      onCreateBlank={onCreateBlank}
      onCreateLearnDify={onCreateLearnDify}
      onCreateTemplate={onCreateTemplate}
      onFetchNextPage={() => appList.fetchNextPage({ cancelRefetch: false })}
      onImportDSL={onImportDSL}
      onOpenTagManagement={onOpenTagManagement}
      onTryLearnDify={onTryLearnDify}
      scrollViewportRef={scrollViewportRef}
      starredApps={starredAppList.data?.data ?? emptyStarredApps}
      systemFeatures={systemFeatures}
    />
  )
}
