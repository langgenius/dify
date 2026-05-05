'use client'

import type { FC } from 'react'
import type { StudioPageType } from '.'
import type { WorkflowOnlineUser } from '@/models/app'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import TagFilter from '@/app/components/base/tag-management/filter'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { CheckModal } from '@/hooks/use-pay'
import { useSnippetAndEvaluationPlanAccess } from '@/hooks/use-snippet-and-evaluation-plan-access'
import dynamic from '@/next/dynamic'
import { fetchWorkflowOnlineUsers } from '@/service/apps'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInfiniteAppList } from '@/service/use-apps'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import SnippetCard from '../snippets/components/snippet-card'
import SnippetCreateCard from '../snippets/components/snippet-create-card'
import AppCard from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import AppTypeFilter from './app-type-filter'
import { parseAsAppListCategory } from './app-type-filter-shared'
import CreatorsFilter from './creators-filter'
import Empty from './empty'
import Footer from './footer'
import useAppsQueryState from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import NewAppCard from './new-app-card'
import StudioRouteSwitch from './studio-route-switch'

const TagManagementModal = dynamic(() => import('@/app/components/base/tag-management'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

type Props = {
  controlRefreshList?: number
  pageType?: StudioPageType
}

const List: FC<Props> = ({
  controlRefreshList = 0,
  pageType = 'apps',
}) => {
  const { t } = useTranslation()
  const isAppsPage = pageType === 'apps'
  const { canAccess: canAccessSnippetsAndEvaluation } = useSnippetAndEvaluationPlanAccess()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useQueryState(
    'category',
    parseAsAppListCategory,
  )

  const { query: { tagIDs = [], creatorIDs = [], keywords = '', isCreatedByMe: queryIsCreatedByMe = false }, setQuery } = useAppsQueryState()
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [appKeywords, setAppKeywords] = useState(keywords)
  const [snippetKeywordsInput, setSnippetKeywordsInput] = useState('')
  const [snippetKeywords, setSnippetKeywords] = useState('')
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const newAppCardRef = useRef<HTMLDivElement>(null)

  const [workflowOnlineUsersMap, setWorkflowOnlineUsersMap] = useState<Record<string, WorkflowOnlineUser[]>>({})
  const setKeywords = useCallback((keywords: string) => {
    setQuery(prev => ({ ...prev, keywords }))
  }, [setQuery])

  const setTagIDs = useCallback((nextTagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs: nextTagIDs }))
  }, [setQuery])

  const setCreatorIDs = useCallback((nextCreatorIDs: string[]) => {
    setQuery(prev => ({ ...prev, creatorIDs: nextCreatorIDs }))
  }, [setQuery])

  const handleDSLFileDropped = useCallback((file: File) => {
    setDroppedDSLFile(file)
    setShowCreateFromDSLModal(true)
  }, [])

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    containerRef,
    enabled: isAppsPage && isCurrentWorkspaceEditor,
  })

  const appListQueryParams = {
    page: 1,
    limit: 30,
    name: appKeywords,
    tag_ids: tagIDs,
    is_created_by_me: queryIsCreatedByMe,
    ...(creatorIDs.length > 0 ? { creator_id: creatorIDs.join(',') } : {}),
    ...(activeTab !== 'all' ? { mode: activeTab } : {}),
  }

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
  } = useInfiniteAppList(appListQueryParams, {
    enabled: isAppsPage && !isCurrentWorkspaceDatasetOperator,
  })

  const {
    data: snippetData,
    isLoading: isSnippetListLoading,
    isFetching: isSnippetListFetching,
    isFetchingNextPage: isSnippetListFetchingNextPage,
    fetchNextPage: fetchSnippetNextPage,
    hasNextPage: hasSnippetNextPage,
    error: snippetError,
  } = useInfiniteSnippetList({
    page: 1,
    limit: 30,
    keyword: snippetKeywords || undefined,
    creator_id: creatorIDs.length > 0 ? creatorIDs.join(',') : undefined,
  }, {
    enabled: !isAppsPage,
  })

  useEffect(() => {
    if (isAppsPage && controlRefreshList > 0)
      refetch()
  }, [controlRefreshList, isAppsPage, refetch])

  useEffect(() => {
    if (!isAppsPage)
      return

    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      refetch()
    }
  }, [isAppsPage, refetch])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return

    const hasMore = isAppsPage ? (hasNextPage ?? true) : (hasSnippetNextPage ?? true)
    const isPageLoading = isAppsPage ? isLoading : isSnippetListLoading
    const isNextPageFetching = isAppsPage ? isFetchingNextPage : isSnippetListFetchingNextPage
    const currentError = isAppsPage ? error : snippetError
    let observer: IntersectionObserver | undefined

    if (currentError) {
      observer?.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isPageLoading && !isNextPageFetching && !currentError && hasMore) {
          if (isAppsPage)
            fetchNextPage()
          else
            fetchSnippetNextPage()
        }
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
        threshold: 0.1,
      })
      observer.observe(anchorRef.current)
    }

    return () => observer?.disconnect()
  }, [error, fetchNextPage, fetchSnippetNextPage, hasNextPage, hasSnippetNextPage, isAppsPage, isCurrentWorkspaceDatasetOperator, isFetchingNextPage, isLoading, isSnippetListFetchingNextPage, isSnippetListLoading, snippetError])

  const { run: handleAppSearch } = useDebounceFn((value: string) => {
    setAppKeywords(value)
  }, { wait: 500 })

  const { run: handleSnippetSearch } = useDebounceFn((value: string) => {
    setSnippetKeywords(value)
  }, { wait: 500 })

  const handleKeywordsChange = useCallback((value: string) => {
    if (isAppsPage) {
      setKeywords(value)
      handleAppSearch(value)
      return
    }

    setSnippetKeywordsInput(value)
    handleSnippetSearch(value)
  }, [handleAppSearch, handleSnippetSearch, isAppsPage, setKeywords])

  const { run: handleTagsUpdate } = useDebounceFn((value: string[]) => {
    setTagIDs(value)
  }, { wait: 500 })

  const handleTagsChange = useCallback((value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate(value)
  }, [handleTagsUpdate])

  const snippetItems = useMemo(() => {
    return (snippetData?.pages ?? []).flatMap(({ data }) => data)
  }, [snippetData?.pages])

  const showSkeleton = isAppsPage
    ? (isLoading || (isFetching && data?.pages?.length === 0))
    : (isSnippetListLoading || (isSnippetListFetching && snippetItems.length === 0))
  const hasAnyApp = (data?.pages?.[0]?.total ?? 0) > 0
  const hasAnySnippet = snippetItems.length > 0
  const currentKeywords = isAppsPage ? keywords : snippetKeywordsInput
  const showEmptyState = !showSkeleton && (isAppsPage ? !hasAnyApp : !hasAnySnippet)
  const emptyStateMessage = isAppsPage
    ? t('newApp.noAppsFound', { ns: 'app' })
    : t('tabs.noSnippetsFound', { ns: 'workflow' })
  const pages = useMemo(() => data?.pages ?? [], [data?.pages])

  const workflowOnlineUserAppIds = useMemo(() => {
    const appIds = new Set<string>()
    pages.forEach(({ data: apps }) => {
      apps.forEach((app) => {
        if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
          appIds.add(app.id)
      })
    })
    return Array.from(appIds)
  }, [pages])

  const refreshWorkflowOnlineUsers = useCallback(async () => {
    if (!systemFeatures.enable_collaboration_mode) {
      setWorkflowOnlineUsersMap({})
      return
    }

    if (!workflowOnlineUserAppIds.length) {
      setWorkflowOnlineUsersMap({})
      return
    }

    try {
      const onlineUsersMap = await fetchWorkflowOnlineUsers({ appIds: workflowOnlineUserAppIds })
      setWorkflowOnlineUsersMap(onlineUsersMap)
    }
    catch {
      setWorkflowOnlineUsersMap({})
    }
  }, [systemFeatures.enable_collaboration_mode, workflowOnlineUserAppIds])

  useEffect(() => {
    void refreshWorkflowOnlineUsers()
  }, [refreshWorkflowOnlineUsers])

  useEffect(() => {
    if (!systemFeatures.enable_collaboration_mode)
      return

    const timer = window.setInterval(() => {
      void refetch()
      void refreshWorkflowOnlineUsers()
    }, 10000)

    return () => window.clearInterval(timer)
  }, [refetch, refreshWorkflowOnlineUsers, systemFeatures.enable_collaboration_mode])

  return (
    <>
      <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2">
          </div>
        )}

        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 bg-background-body px-12 pt-7 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <StudioRouteSwitch
              pageType={pageType}
              appsLabel={t('studio.apps', { ns: 'app' })}
              snippetsLabel={t('tabs.snippets', { ns: 'workflow' })}
              showSnippets={canAccessSnippetsAndEvaluation}
            />
            {isAppsPage && (
              <AppTypeFilter
                activeTab={activeTab}
                onChange={(value) => {
                  void setActiveTab(value)
                }}
              />
            )}
            <CreatorsFilter value={creatorIDs} onChange={setCreatorIDs} />
            {isAppsPage && (
              <TagFilter type="app" value={tagFilterValue} onChange={handleTagsChange} />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              showLeftIcon
              showClearIcon
              wrapperClassName="w-[200px]"
              placeholder={isAppsPage ? undefined : t('tabs.searchSnippets', { ns: 'workflow' })}
              value={currentKeywords}
              onChange={e => handleKeywordsChange(e.target.value)}
              onClear={() => handleKeywordsChange('')}
            />
          </div>
        </div>

        <div className={cn(
          'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
          showEmptyState && 'overflow-hidden',
        )}
        >
          {(isCurrentWorkspaceEditor || isLoadingCurrentWorkspace) && (
            isAppsPage
              ? (
                <NewAppCard
                  ref={newAppCardRef}
                  isLoading={isLoadingCurrentWorkspace}
                  onSuccess={refetch}
                  selectedAppType={activeTab}
                  className={cn(!hasAnyApp && 'z-10')}
                />
              )
              : canAccessSnippetsAndEvaluation && <SnippetCreateCard />
          )}

          {showSkeleton && <AppCardSkeleton count={6} />}

          {!showSkeleton && isAppsPage && hasAnyApp && pages.flatMap(({ data: apps }) => apps).map(app => (
            <AppCard
              key={app.id}
              app={app}
              onlineUsers={workflowOnlineUsersMap[app.id] ?? []}
              onRefresh={refetch}
            />
          ))}

          {!showSkeleton && !isAppsPage && hasAnySnippet && snippetItems.map(snippet => (
            <SnippetCard key={snippet.id} snippet={snippet} />
          ))}

          {showEmptyState && <Empty message={emptyStateMessage} />}

          {isAppsPage && isFetchingNextPage && (
            <AppCardSkeleton count={3} />
          )}

          {!isAppsPage && isSnippetListFetchingNextPage && (
            <AppCardSkeleton count={3} />
          )}
        </div>

        {isAppsPage && isCurrentWorkspaceEditor && (
          <div
            className={cn(
              'flex items-center justify-center gap-2 py-4',
              dragging ? 'text-text-accent' : 'text-text-quaternary',
            )}
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
        {isAppsPage && showTagManagementModal && (
          <TagManagementModal type="app" show={showTagManagementModal} />
        )}
      </div>

      {isAppsPage && showCreateFromDSLModal && (
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
