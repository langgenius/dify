'use client'

import type { AppListQuery } from '@/contract/console/apps'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { CheckModal } from '@/hooks/use-pay'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { AppModeEnum } from '@/types/app'
import AppCard from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import { AppListCreationModals } from './app-list-creation-modals'
import AppListHeaderFilters from './app-list-header-filters'
import { AppListTagManagementModal } from './app-list-tag-management-modal'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import Empty from './empty'
import FirstEmptyState from './first-empty-state'
import Footer from './footer'
import { isAppListCategory, useAppsQueryState } from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useWorkflowOnlineUsers } from './hooks/use-workflow-online-users'
import NewAppCard from './new-app-card'

function List({ controlRefreshList = 0 }: { controlRefreshList?: number }) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const { onPlanInfoChanged } = useProviderContext()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { replace } = useRouter()

  // eslint-disable-next-line react/use-state -- custom URL query hook, not React.useState
  const {
    query: { category, keywords, isCreatedByMe, emptyAppList },
    setCategory,
    setKeywords,
    setIsCreatedByMe,
  } = useAppsQueryState()
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const debouncedKeywords = useDebounce(keywords, { wait: APP_LIST_SEARCH_DEBOUNCE_MS })
  const newAppCardRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [showNewAppTemplateDialog, setShowNewAppTemplateDialog] = useState(false)
  const [showNewAppModal, setShowNewAppModal] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()

  const handleDSLFileDropped = useCallback((file: File) => {
    setDroppedDSLFile(file)
    setShowCreateFromDSLModal(true)
  }, [])

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    containerRef,
    enabled: isCurrentWorkspaceEditor,
  })

  useEffect(() => {
    if (!searchParams.has('tagIDs'))
      return

    const params = new URLSearchParams(searchParams.toString())
    params.delete('tagIDs')
    const query = params.toString()
    replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, replace, searchParams])

  const appListQuery = useMemo<AppListQuery>(() => ({
    page: 1,
    limit: 30,
    name: debouncedKeywords,
    ...(tagIDs.length ? { tag_ids: tagIDs } : {}),
    ...(isCreatedByMe ? { is_created_by_me: isCreatedByMe } : {}),
    ...(category !== 'all' ? { mode: category } : {}),
  }), [category, debouncedKeywords, isCreatedByMe, tagIDs])

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
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          ...appListQuery,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    enabled: !isCurrentWorkspaceDatasetOperator,
    refetchInterval: systemFeatures.enable_collaboration_mode ? 10000 : false,
  })

  useEffect(() => {
    if (controlRefreshList > 0) {
      refetch()
    }
  }, [controlRefreshList, refetch])

  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      refetch()
    }
  }, [refetch])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) {
      if (observer)
        observer.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
        threshold: 0.1,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage, isCurrentWorkspaceDatasetOperator])

  const handleCreatedByMeChange = useCallback((checked: boolean) => {
    setIsCreatedByMe(checked)
  }, [setIsCreatedByMe])

  const categoryRef = useRef(category)
  useEffect(() => {
    categoryRef.current = category
  }, [category])

  const handleCategoryChange = useCallback((nextValue: string | null) => {
    if (!nextValue || !isAppListCategory(nextValue) || nextValue === categoryRef.current)
      return
    categoryRef.current = nextValue
    setCategory(nextValue)
  }, [setCategory])

  const pages = useMemo(() => emptyAppList ? [{ data: [], total: 0 }] : data?.pages ?? [], [data?.pages, emptyAppList])
  const apps = useMemo(() => pages.flatMap(({ data: pageApps }) => pageApps), [pages])

  const workflowOnlineUserAppIds = useMemo(() => {
    const appIds = new Set<string>()
    apps.forEach((app) => {
      if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
        appIds.add(app.id)
    })
    return Array.from(appIds)
  }, [apps])

  const {
    onlineUsersMap: workflowOnlineUsersMap,
  } = useWorkflowOnlineUsers({
    appIds: workflowOnlineUserAppIds,
    enabled: systemFeatures.enable_collaboration_mode,
  })

  const hasResolvedFirstPage = pages.length > 0
  const hasAnyApp = (pages[0]?.total ?? 0) > 0
  const hasActiveFilters = category !== 'all' || tagIDs.length > 0 || keywords.trim().length > 0 || debouncedKeywords.trim().length > 0 || isCreatedByMe
  const showSkeleton = !emptyAppList && (isLoading || (isFetching && pages.length === 0))
  const showFirstEmptyState = !showSkeleton && !hasAnyApp && isCurrentWorkspaceEditor && (emptyAppList || (hasResolvedFirstPage && !hasActiveFilters))

  return (
    <>
      <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2">
          </div>
        )}

        <div className="sticky top-0 z-10 flex flex-col bg-background-body px-6 pt-2 pb-2">
          <div className="flex min-h-14 items-start pt-2">
            <div className="flex flex-col gap-0.5">
              <h1 className="text-xl/6 font-semibold text-dify-logo-black">{t('menus.apps', { ns: 'common' })}</h1>
              <p className="system-sm-regular text-text-tertiary">{t('studioDescription', { ns: 'app' })}</p>
            </div>
          </div>
          {!showFirstEmptyState && (
            <AppListHeaderFilters
              category={category}
              tagIDs={tagIDs}
              keywords={keywords}
              isCreatedByMe={isCreatedByMe}
              onCategoryChange={handleCategoryChange}
              onTagIDsChange={setTagIDs}
              onKeywordsChange={setKeywords}
              onCreatedByMeChange={handleCreatedByMeChange}
              onCreateBlank={() => setShowNewAppModal(true)}
              onCreateTemplate={() => setShowNewAppTemplateDialog(true)}
              onImportDSL={() => setShowCreateFromDSLModal(true)}
              onOpenTagManagement={() => setShowTagManagementModal(true)}
              showCreateButton={isCurrentWorkspaceEditor}
            />
          )}
        </div>
        {showFirstEmptyState
          ? (
              <FirstEmptyState
                onCreateBlank={() => setShowNewAppModal(true)}
                onCreateTemplate={() => setShowNewAppTemplateDialog(true)}
                onImportDSL={() => setShowCreateFromDSLModal(true)}
              />
            )
          : (
              <div className={cn(
                'relative grid grow grid-cols-1 content-start gap-3 px-6 pt-2 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
                !hasAnyApp && 'overflow-hidden',
              )}
              >
                {(isCurrentWorkspaceEditor || isLoadingCurrentWorkspace) && hasAnyApp && (
                  <NewAppCard
                    ref={newAppCardRef}
                    isLoading={isLoadingCurrentWorkspace}
                    onSuccess={refetch}
                    selectedAppType={category}
                    className={cn(!hasAnyApp && 'z-10')}
                  />
                )}
                {showSkeleton
                  ? <AppCardSkeleton count={6} />
                  : hasAnyApp
                    ? apps.map(app => (
                        <AppCard
                          key={app.id}
                          app={app}
                          onlineUsers={workflowOnlineUsersMap[app.id] ?? []}
                          onRefresh={refetch}
                          onOpenTagManagement={() => setShowTagManagementModal(true)}
                        />
                      ))
                    : <Empty />}
                {isFetchingNextPage && (
                  <AppCardSkeleton count={3} />
                )}
              </div>
            )}

        {isCurrentWorkspaceEditor && !showFirstEmptyState && (
          <div
            className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}
            role="region"
            aria-label={t('newApp.dropDSLToCreateApp', { ns: 'app' })}
          >
            <span className="i-ri-drag-drop-line size-4" />
            <span className="system-xs-regular">{t('newApp.dropDSLToCreateApp', { ns: 'app' })}</span>
          </div>
        )}
        {!systemFeatures.branding.enabled && !showFirstEmptyState && (
          <Footer />
        )}
        <CheckModal />
        <div ref={anchorRef} className="h-0"> </div>
        <AppListTagManagementModal
          show={showTagManagementModal}
          onClose={() => setShowTagManagementModal(false)}
          onTagsChange={refetch}
        />
      </div>

      <AppListCreationModals
        category={category}
        droppedDSLFile={droppedDSLFile}
        showCreateFromDSLModal={showCreateFromDSLModal}
        showNewAppModal={showNewAppModal}
        showNewAppTemplateDialog={showNewAppTemplateDialog}
        onPlanInfoChanged={onPlanInfoChanged}
        onRefetch={refetch}
        onSetDroppedDSLFile={setDroppedDSLFile}
        onSetShowCreateFromDSLModal={setShowCreateFromDSLModal}
        onSetShowNewAppModal={setShowNewAppModal}
        onSetShowNewAppTemplateDialog={setShowNewAppTemplateDialog}
      />
    </>
  )
}

export default List
