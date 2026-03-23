'use client'

import type { FC } from 'react'
import type { StudioPageType } from '.'
import type { App } from '@/types/app'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import TagFilter from '@/app/components/base/tag-management/filter'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { CheckModal } from '@/hooks/use-pay'
import dynamic from '@/next/dynamic'
import { useInfiniteAppList } from '@/service/use-apps'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import { cn } from '@/utils/classnames'
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
  const { systemFeatures } = useGlobalPublicStore()
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useQueryState(
    'category',
    parseAsAppListCategory,
  )

  const { query: { tagIDs = [], keywords = '', isCreatedByMe: queryIsCreatedByMe = false }, setQuery } = useAppsQueryState()
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [appKeywords, setAppKeywords] = useState(keywords)
  const [snippetKeywordsInput, setSnippetKeywordsInput] = useState('')
  const [snippetKeywords, setSnippetKeywords] = useState('')
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const newAppCardRef = useRef<HTMLDivElement>(null)

  const setKeywords = useCallback((nextKeywords: string) => {
    setQuery(prev => ({ ...prev, keywords: nextKeywords }))
  }, [setQuery])

  const setTagIDs = useCallback((nextTagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs: nextTagIDs }))
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
        if (entries[0].isIntersecting && !isPageLoading && !isNextPageFetching && !currentError && hasMore) {
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

  const appItems = useMemo<App[]>(() => {
    return (data?.pages ?? []).flatMap(({ data: apps }) => apps)
  }, [data?.pages])

  const snippetItems = useMemo(() => {
    return (snippetData?.pages ?? []).flatMap(({ data }) => data)
  }, [snippetData?.pages])

  const showSkeleton = isAppsPage
    ? (isLoading || (isFetching && data?.pages?.length === 0))
    : (isSnippetListLoading || (isSnippetListFetching && snippetItems.length === 0))
  const hasAnyApp = (data?.pages?.[0]?.total ?? 0) > 0
  const hasAnySnippet = snippetItems.length > 0
  const currentKeywords = isAppsPage ? keywords : snippetKeywordsInput

  return (
    <>
      <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2" />
        )}

        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 bg-background-body px-12 pb-5 pt-7">
          <div className="flex flex-wrap items-center gap-2">
            <StudioRouteSwitch
              pageType={pageType}
              appsLabel={t('studio.apps', { ns: 'app' })}
              snippetsLabel={t('tabs.snippets', { ns: 'workflow' })}
            />
            {isAppsPage && (
              <AppTypeFilter
                activeTab={activeTab}
                onChange={(value) => {
                  void setActiveTab(value)
                }}
              />
            )}
            <CreatorsFilter />
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
          'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6',
          isAppsPage && !hasAnyApp && 'overflow-hidden',
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
              : <SnippetCreateCard />
          )}

          {showSkeleton && <AppCardSkeleton count={6} />}

          {!showSkeleton && isAppsPage && hasAnyApp && appItems.map(app => (
            <AppCard key={app.id} app={app} onRefresh={refetch} />
          ))}

          {!showSkeleton && !isAppsPage && hasAnySnippet && snippetItems.map(snippet => (
            <SnippetCard key={snippet.id} snippet={snippet} />
          ))}

          {!showSkeleton && isAppsPage && !hasAnyApp && <Empty />}

          {!showSkeleton && !isAppsPage && !hasAnySnippet && (
            <div className="col-span-full flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-6 text-center text-sm text-text-tertiary">
              {t('tabs.noSnippetsFound', { ns: 'workflow' })}
            </div>
          )}

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
