'use client'

import type { AppListQuery } from '@/contract/console/apps'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { CheckModal } from '@/hooks/use-pay'
import dynamic from '@/next/dynamic'
import Link from '@/next/link'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import AppCard from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import { AppTypeFilter } from './app-type-filter'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import CreatorsFilter from './creators-filter'
import Empty from './empty'
import Footer from './footer'
import { useAppsQueryState } from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useWorkflowOnlineUsers } from './hooks/use-workflow-online-users'
import NewAppCard from './new-app-card'

const TagManagementModal = dynamic(() => import('@/features/tag-management/components/tag-management-modal').then(mod => mod.TagManagementModal), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

type Props = Readonly<{
  controlRefreshList?: number
}>
function List({
  controlRefreshList = 0,
}: Props) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { replace } = useRouter()

  // eslint-disable-next-line react/use-state -- custom URL query hook, not React.useState
  const {
    query: { category, keywords, creatorIDs },
    setCategory,
    setKeywords,
    setCreatorIDs,
  } = useAppsQueryState()
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const debouncedKeywords = useDebounce(keywords, { wait: APP_LIST_SEARCH_DEBOUNCE_MS })
  const newAppCardRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const [needRefreshAppList, setNeedRefreshAppList] = useLocalStorage<string>(NEED_REFRESH_APP_LIST_KEY, '0', { raw: true })

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
    ...(creatorIDs.length ? { creator_ids: creatorIDs } : {}),
    ...(category !== 'all' ? { mode: category } : {}),
  }), [category, creatorIDs, debouncedKeywords, tagIDs])

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
    if (needRefreshAppList === '1') {
      setNeedRefreshAppList(null)
      refetch()
    }
  }, [needRefreshAppList, refetch, setNeedRefreshAppList])

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
      // Calculate dynamic rootMargin: clamps to 100-200px range, using 20% of container height as the base value for better responsiveness
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200)) // Clamps to 100-200px range, using 20% of container height as the base value

      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
        threshold: 0.1, // Trigger when 10% of the anchor element is visible
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage, isCurrentWorkspaceDatasetOperator])

  const pages = useMemo(() => data?.pages ?? [], [data?.pages])
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

  const hasAnyApp = (pages[0]?.total ?? 0) > 0
  // Show skeleton during initial load or when refetching with no previous data
  const showSkeleton = isLoading || (isFetching && pages.length === 0)

  return (
    <>
      <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2">
          </div>
        )}

        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background-body px-12 pt-7 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <AppTypeFilter
              value={category}
              onChange={setCategory}
            />
            <CreatorsFilter
              value={creatorIDs}
              onChange={setCreatorIDs}
            />
            <TagFilter type="app" value={tagIDs} onChange={setTagIDs} onOpenTagManagement={() => setShowTagManagementModal(true)} />
            <div className="relative w-50">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder" />
              <SearchInput
                className="w-52"
                value={keywords}
                onValueChange={setKeywords}
                placeholder={t('operation.search', { ns: 'common' })}
                aria-label={t('gotoAnything.actions.searchApplications', { ns: 'app' })}
              />
            </div>
          </div>
          <Link
            href="/snippets"
            className="flex h-8 items-center rounded-lg px-3 text-sm font-semibold text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
          >
            {t('studio.viewSnippets', { ns: 'app' })}
          </Link>
        </div>
        <div className={cn(
          'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
          !hasAnyApp && 'overflow-hidden',
        )}
        >
          {(isCurrentWorkspaceEditor || isLoadingCurrentWorkspace) && (
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

        {isCurrentWorkspaceEditor && (
          <div
            className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}
            role="region"
            aria-label={t('newApp.dropDSLToCreateApp', { ns: 'app' })}
          >
            <span className="i-ri-drag-drop-line size-4" />
            <span className="system-xs-regular">{t('newApp.dropDSLToCreateApp', { ns: 'app' })}</span>
          </div>
        )}
        {!systemFeatures.branding.enabled && (
          <Footer />
        )}
        <CheckModal />
        <div ref={anchorRef} className="h-0"> </div>
        <TagManagementModal
          type="app"
          show={showTagManagementModal}
          onClose={() => setShowTagManagementModal(false)}
          onTagsChange={refetch}
        />
      </div>

      {showCreateFromDSLModal && (
        <CreateFromDSLModal
          show={showCreateFromDSLModal}
          onClose={() => {
            setShowCreateFromDSLModal(false)
            setDroppedDSLFile(undefined)
          }}
          onSuccess={() => {
            setShowCreateFromDSLModal(false)
            setDroppedDSLFile(undefined)
            refetch()
          }}
          droppedFile={droppedDSLFile}
        />
      )}
    </>
  )
}

export default List
