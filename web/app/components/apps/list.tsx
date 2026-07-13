'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNeedRefreshAppList } from '@/app/components/apps/storage'
import {
  useSetStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
} from '@/app/components/step-by-step-tour/storage'
import {
  getStepByStepTourGuides,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { CheckModal } from '@/hooks/use-pay'
import { consoleQuery } from '@/service/client'
import { normalizeAppPagination } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import { hasPermission } from '@/utils/permission'
import { AppCard } from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import { AppListCreationModals } from './app-list-creation-modals'
import { AppListHeaderFilters } from './app-list-header-filters'
import { AppListTagManagementModal } from './app-list-tag-management-modal'
import { APP_LIST_GRID_CLASS_NAME, APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import Empty from './empty'
import FirstEmptyState from './first-empty-state'
import { useAppsQueryState } from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useWorkflowOnlineUsers } from './hooks/use-workflow-online-users'
import { StarredAppList } from './starred-app-list'
import { StudioListHeader } from './studio-list-header'

const STARRED_APP_LIMIT = 100
const STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT = 4

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>

type Props = Readonly<{
  controlRefreshList?: number
}>

function List({ controlRefreshList = 0 }: Props) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { onPlanInfoChanged } = useProviderContext()

  // eslint-disable-next-line react/use-state -- custom URL query hook, not React.useState
  const {
    query: { category, keywords, creatorIDs },
    setCategory,
    setKeywords,
    setCreatorIDs,
  } = useAppsQueryState()
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<AppListSortBy>('last_modified')
  const debouncedKeywords = useDebounce(keywords, { wait: APP_LIST_SEARCH_DEBOUNCE_MS })
  const containerRef = useRef<HTMLDivElement>(null)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [showNewAppTemplateDialog, setShowNewAppTemplateDialog] = useState(false)
  const [showNewAppModal, setShowNewAppModal] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const [needsRefreshAppList, setNeedsRefreshAppList] = useNeedRefreshAppList()
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const stepByStepTourAccountState = useStepByStepTourAccountStateValue()
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const setStepByStepTourAccountState = useSetStepByStepTourAccountState()
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')

  const handleDSLFileDropped = useCallback(
    (file: File) => {
      if (!canCreateApp) return

      setDroppedDSLFile(file)
      setShowCreateFromDSLModal(true)
    },
    [canCreateApp],
  )

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    containerRef,
    enabled: canCreateApp,
  })

  const appListQuery = useMemo<AppListQuery>(
    () => ({
      page: 1,
      limit: 30,
      name: debouncedKeywords,
      sort_by: sortBy,
      ...(tagIDs.length ? { tag_ids: tagIDs } : {}),
      ...(creatorIDs.length ? { creator_ids: creatorIDs } : {}),
      ...(category !== 'all' ? { mode: category } : {}),
    }),
    [category, creatorIDs, debouncedKeywords, sortBy, tagIDs],
  )

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
  } = useInfiniteQuery({
    ...consoleQuery.apps.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          ...appListQuery,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    select: (data) => ({
      ...data,
      pages: data.pages.map(normalizeAppPagination),
    }),
    refetchInterval: systemFeatures.enable_collaboration_mode ? 10000 : false,
  })

  const starredAppListQuery = useMemo<AppListQuery>(
    () => ({
      ...appListQuery,
      page: 1,
      limit: STARRED_APP_LIMIT,
    }),
    [appListQuery],
  )

  const { data: starredAppList, refetch: refetchStarredAppList } = useQuery({
    ...consoleQuery.apps.starred.get.queryOptions({
      input: {
        query: starredAppListQuery,
      },
      select: normalizeAppPagination,
    }),
  })

  const refreshAppLists = useCallback(() => {
    void refetch()
    void refetchStarredAppList()
  }, [refetch, refetchStarredAppList])

  useEffect(() => {
    if (controlRefreshList > 0) refetch()
  }, [controlRefreshList, refetch])

  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (needsRefreshAppList === '1') {
      setNeedsRefreshAppList(null)
      refetch()
    }
  }, [needsRefreshAppList, refetch, setNeedsRefreshAppList])

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) {
      if (observer) observer.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]!.isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
            fetchNextPage()
        },
        {
          root: containerRef.current,
          rootMargin: `${dynamicMargin}px`,
          threshold: 0.1,
        },
      )
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage])

  const pages = useMemo(() => data?.pages ?? [], [data?.pages])
  const apps = useMemo(() => pages.flatMap(({ data: pageApps }) => pageApps), [pages])
  const starredApps = useMemo(() => starredAppList?.data ?? [], [starredAppList?.data])

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

  const hasResolvedFirstPage = pages.length > 0
  const hasAnyApp = (pages[0]?.total ?? 0) > 0
  const hasActiveFilters =
    category !== 'all' ||
    tagIDs.length > 0 ||
    keywords.trim().length > 0 ||
    debouncedKeywords.trim().length > 0 ||
    creatorIDs.length > 0
  const showSkeleton = isLoading || (isFetching && pages.length === 0)
  const showFirstEmptyState =
    !showSkeleton && !hasAnyApp && canCreateApp && hasResolvedFirstPage && !hasActiveFilters
  const showNoCreateEmptyState =
    !showSkeleton && !hasAnyApp && !canCreateApp && hasResolvedFirstPage && !hasActiveFilters
  const activeStudioGuideGroup = canCreateApp
    ? showFirstEmptyState
      ? 'studioEmpty'
      : hasAnyApp
        ? 'studioWithApps'
        : undefined
    : hasAnyApp
      ? 'studioNoCreateWithApps'
      : showNoCreateEmptyState
        ? 'studioNoCreateEmpty'
        : undefined
  const effectiveActiveStudioGuideGroup =
    stepByStepTourAccountState.activeGuideGroup ?? activeStudioGuideGroup
  const activeStudioGuides =
    stepByStepTourAccountState.activeTaskId === 'studio' && effectiveActiveStudioGuideGroup
      ? getStepByStepTourGuides('studio', effectiveActiveStudioGuideGroup)
      : []
  const activeStudioGuide = activeStudioGuides[stepByStepTourAccountState.activeGuideIndex ?? 0]
  const shouldOpenStepByStepTourCreateMenu =
    activeStudioGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate
  const shouldOpenStepByStepTourAppCardActionMenu =
    activeStudioGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard
  const shouldHighlightStepByStepTourNoCreateAppRow =
    activeStudioGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
  const shouldHighlightStepByStepTourStarredAppRow =
    shouldHighlightStepByStepTourNoCreateAppRow && starredApps.length > 0
  const shouldHighlightStepByStepTourAllAppsRow =
    shouldHighlightStepByStepTourNoCreateAppRow && !shouldHighlightStepByStepTourStarredAppRow
  const openCreateBlankModal = useCallback(() => {
    if (canCreateApp) setShowNewAppModal(true)
  }, [canCreateApp])
  const openCreateTemplateDialog = useCallback(() => {
    if (canCreateApp) setShowNewAppTemplateDialog(true)
  }, [canCreateApp])
  const openCreateFromDSLModal = useCallback(() => {
    if (canCreateApp) setShowCreateFromDSLModal(true)
  }, [canCreateApp])

  useEffect(() => {
    if (stepByStepTourAccountState.activeTaskId !== 'studio') return
    if (!hasResolvedFirstPage || showSkeleton || !activeStudioGuideGroup) return
    if (stepByStepTourAccountState.activeGuideGroup === activeStudioGuideGroup) return

    // Sync the active walkthrough branch into the tour storage owner after the
    // Studio list data resolves.
    // eslint-disable-next-line react/set-state-in-effect
    setStepByStepTourAccountState({
      ...stepByStepTourAccountState,
      activeGuideGroup: activeStudioGuideGroup,
      activeGuideIndex: 0,
    })
  }, [
    activeStudioGuideGroup,
    hasResolvedFirstPage,
    setStepByStepTourAccountState,
    showSkeleton,
    stepByStepTourAccountState,
  ])

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body"
      >
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2"></div>
        )}

        <StudioListHeader
          title={
            <div className="flex items-center">
              <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">
                {t(($) => $['menus.apps'], { ns: 'common' })}
              </h1>
            </div>
          }
        >
          <AppListHeaderFilters
            category={category}
            tagIDs={tagIDs}
            keywords={keywords}
            creatorIDs={creatorIDs}
            sortBy={sortBy}
            onCategoryChange={setCategory}
            onTagIDsChange={setTagIDs}
            onKeywordsChange={setKeywords}
            onCreatorIDsChange={setCreatorIDs}
            onSortByChange={setSortBy}
            onCreateBlank={openCreateBlankModal}
            onCreateTemplate={openCreateTemplateDialog}
            onImportDSL={openCreateFromDSLModal}
            onOpenTagManagement={() => setShowTagManagementModal(true)}
            showCreateButton={canCreateApp}
            stepByStepTourCreateMenuOpen={
              activeStudioGuide ? shouldOpenStepByStepTourCreateMenu : undefined
            }
            stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate}
            stepByStepTourCreateMenuHighlightPart={
              STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu
            }
          />
        </StudioListHeader>
        {showFirstEmptyState ? (
          <FirstEmptyState
            onCreateBlank={openCreateBlankModal}
            onCreateTemplate={openCreateTemplateDialog}
            onImportDSL={openCreateFromDSLModal}
            showLearnDify={systemFeatures.enable_learn_app}
          />
        ) : (
          <>
            {starredApps.length > 0 && (
              <StarredAppList
                apps={starredApps}
                onRefresh={refreshAppLists}
                stepByStepTourCardTarget={
                  shouldHighlightStepByStepTourStarredAppRow
                    ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
                    : undefined
                }
                stepByStepTourCardHighlightPart={
                  shouldHighlightStepByStepTourStarredAppRow
                    ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard
                    : undefined
                }
                stepByStepTourHighlightedCardCount={
                  shouldHighlightStepByStepTourStarredAppRow
                    ? STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT
                    : 0
                }
              />
            )}
            <div
              className={cn(
                `relative grow content-start ${APP_LIST_GRID_CLASS_NAME}`,
                !hasAnyApp && 'overflow-hidden',
              )}
            >
              {showSkeleton ? (
                <AppCardSkeleton count={6} />
              ) : hasAnyApp ? (
                apps.map((app, index) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onlineUsers={workflowOnlineUsersMap[app.id] ?? []}
                    onRefresh={refreshAppLists}
                    onOpenTagManagement={() => setShowTagManagementModal(true)}
                    stepByStepTourActionMenuOpen={
                      index === 0 ? shouldOpenStepByStepTourAppCardActionMenu : undefined
                    }
                    stepByStepTourCardTarget={
                      index === 0
                        ? shouldHighlightStepByStepTourAllAppsRow
                          ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard
                          : canCreateApp
                            ? STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard
                            : undefined
                        : undefined
                    }
                    stepByStepTourCardHighlightPart={
                      index < STEP_BY_STEP_TOUR_APP_ROW_CARD_COUNT &&
                      shouldHighlightStepByStepTourAllAppsRow
                        ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard
                        : undefined
                    }
                    stepByStepTourActionMenuHighlightPart={
                      index === 0 && shouldOpenStepByStepTourAppCardActionMenu
                        ? STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu
                        : undefined
                    }
                  />
                ))
              ) : (
                <Empty
                  stepByStepTourTarget={
                    showNoCreateEmptyState
                      ? STEP_BY_STEP_TOUR_TARGETS.studioNoCreateEmpty
                      : undefined
                  }
                />
              )}
              {isFetchingNextPage && <AppCardSkeleton count={3} />}
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
        <CheckModal />
        <div ref={anchorRef} className="h-0">
          {' '}
        </div>
        <AppListTagManagementModal
          show={showTagManagementModal}
          onClose={() => setShowTagManagementModal(false)}
          onTagsChange={refreshAppLists}
        />
      </div>

      <AppListCreationModals
        canCreateApp={canCreateApp}
        category={category}
        droppedDSLFile={droppedDSLFile}
        showCreateFromDSLModal={showCreateFromDSLModal}
        showNewAppModal={showNewAppModal}
        showNewAppTemplateDialog={showNewAppTemplateDialog}
        onPlanInfoChanged={onPlanInfoChanged}
        onRefetch={refreshAppLists}
        onSetDroppedDSLFile={setDroppedDSLFile}
        onSetShowCreateFromDSLModal={setShowCreateFromDSLModal}
        onSetShowNewAppModal={setShowNewAppModal}
        onSetShowNewAppTemplateDialog={setShowNewAppTemplateDialog}
      />
    </>
  )
}

export default List
