'use client'

import type { FC } from 'react'
import type { AppListQuery } from '@/contract/console/apps'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import TagFilter from '@/app/components/base/tag-management/filter'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { CheckModal } from '@/hooks/use-pay'
import dynamic from '@/next/dynamic'
import { consoleQuery } from '@/service/client'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { AppModeEnum, AppModes } from '@/types/app'
import AppCard from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import Empty from './empty'
import Footer from './footer'
import useAppsQueryState from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useWorkflowOnlineUsers } from './hooks/use-workflow-online-users'
import NewAppCard from './new-app-card'

const TagManagementModal = dynamic(() => import('@/app/components/base/tag-management'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

const APP_LIST_CATEGORY_VALUES = ['all', ...AppModes] as const
type AppListCategory = typeof APP_LIST_CATEGORY_VALUES[number]
const appListCategorySet = new Set<string>(APP_LIST_CATEGORY_VALUES)

const isAppListCategory = (value: string): value is AppListCategory => {
  return appListCategorySet.has(value)
}

const parseAsAppListCategory = parseAsStringLiteral(APP_LIST_CATEGORY_VALUES)
  .withDefault('all')
  .withOptions({ history: 'push' })

type Props = {
  controlRefreshList?: number
}
const List: FC<Props> = ({
  controlRefreshList = 0,
}) => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useQueryState(
    'category',
    parseAsAppListCategory,
  )

  const { query: { tagIDs = [], keywords = '', isCreatedByMe: queryIsCreatedByMe = false }, setQuery } = useAppsQueryState()
  const [isCreatedByMe, setIsCreatedByMe] = useState(queryIsCreatedByMe)
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [searchKeywords, setSearchKeywords] = useState(keywords)
  const newAppCardRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const setKeywords = useCallback((keywords: string) => {
    setQuery(prev => ({ ...prev, keywords }))
  }, [setQuery])
  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs }))
  }, [setQuery])

  const handleDSLFileDropped = useCallback((file: File) => {
    setDroppedDSLFile(file)
    setShowCreateFromDSLModal(true)
  }, [])

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    containerRef,
    enabled: isCurrentWorkspaceEditor,
  })

  const appListQuery = useMemo<AppListQuery>(() => ({
    page: 1,
    limit: 30,
    name: searchKeywords,
    ...(tagIDs.length ? { tag_ids: tagIDs } : {}),
    ...(isCreatedByMe ? { is_created_by_me: isCreatedByMe } : {}),
    ...(activeTab !== 'all' ? { mode: activeTab } : {}),
  }), [activeTab, isCreatedByMe, searchKeywords, tagIDs])

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
  const options = [
    { value: 'all', text: t('types.all', { ns: 'app' }), icon: <span className="mr-1 i-ri-apps-2-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.WORKFLOW, text: t('types.workflow', { ns: 'app' }), icon: <span className="mr-1 i-ri-exchange-2-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.ADVANCED_CHAT, text: t('types.advanced', { ns: 'app' }), icon: <span className="mr-1 i-ri-message-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.CHAT, text: t('types.chatbot', { ns: 'app' }), icon: <span className="mr-1 i-ri-message-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.AGENT_CHAT, text: t('types.agent', { ns: 'app' }), icon: <span className="mr-1 i-ri-robot-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.COMPLETION, text: t('types.completion', { ns: 'app' }), icon: <span className="mr-1 i-ri-file-4-line h-[14px] w-[14px]" /> },
  ]

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

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const { run: handleTagsUpdate } = useDebounceFn(() => {
    setTagIDs(tagFilterValue)
  }, { wait: 500 })
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  const handleCreatedByMeChange = useCallback(() => {
    const newValue = !isCreatedByMe
    setIsCreatedByMe(newValue)
    setQuery(prev => ({ ...prev, isCreatedByMe: newValue }))
  }, [isCreatedByMe, setQuery])

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

        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 bg-background-body px-12 pt-7 pb-5">
          <TabSliderNew
            value={activeTab}
            onChange={(nextValue) => {
              if (isAppListCategory(nextValue))
                setActiveTab(nextValue)
            }}
            options={options}
          />
          <div className="flex items-center gap-2">
            <label className="mr-2 flex h-7 items-center space-x-2">
              <Checkbox checked={isCreatedByMe} onCheck={handleCreatedByMeChange} />
              <div className="text-sm font-normal text-text-secondary">
                {t('showMyCreatedAppsOnly', { ns: 'app' })}
              </div>
            </label>
            <TagFilter type="app" value={tagFilterValue} onChange={handleTagsChange} />
            <Input
              showLeftIcon
              showClearIcon
              wrapperClassName="w-[200px]"
              value={keywords}
              onChange={e => handleKeywordsChange(e.target.value)}
              onClear={() => handleKeywordsChange('')}
            />
          </div>
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
              selectedAppType={activeTab}
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
            <span className="i-ri-drag-drop-line h-4 w-4" />
            <span className="system-xs-regular">{t('newApp.dropDSLToCreateApp', { ns: 'app' })}</span>
          </div>
        )}
        {!systemFeatures.branding.enabled && (
          <Footer />
        )}
        <CheckModal />
        <div ref={anchorRef} className="h-0"> </div>
        {showTagManagementModal && (
          <TagManagementModal type="app" show={showTagManagementModal} />
        )}
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
