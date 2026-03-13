'use client'

import type { FC } from 'react'
import type { StudioPageType } from '.'
import type { App } from '@/types/app'
import { useDebounceFn } from 'ahooks'
import dynamic from 'next/dynamic'
import Link from 'next/link'
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
import { useInfiniteAppList } from '@/service/use-apps'
import { cn } from '@/utils/classnames'
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

const TagManagementModal = dynamic(() => import('@/app/components/base/tag-management'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

type StudioSnippet = {
  id: string
  name: string
  description: string
  author: string
  updatedAt: string
  usage: string
  icon: string
  status?: string
}

const StudioRouteSwitch = ({ pageType, appsLabel, snippetsLabel }: { pageType: StudioPageType, appsLabel: string, snippetsLabel: string }) => {
  return (
    <div className="flex items-center rounded-lg border-[0.5px] border-divider-subtle bg-[rgba(200,206,218,0.2)] p-[1px]">
      <Link
        href="/apps"
        className={cn(
          'flex h-8 items-center rounded-lg px-3 text-[14px] leading-5 text-text-secondary',
          pageType === 'apps' && 'bg-components-card-bg font-semibold text-text-primary shadow-xs',
          pageType !== 'apps' && 'font-medium',
        )}
      >
        {appsLabel}
      </Link>
      <Link
        href="/snippets"
        className={cn(
          'flex h-8 items-center rounded-lg px-3 text-[14px] leading-5 text-text-secondary',
          pageType === 'snippets' && 'bg-components-card-bg font-semibold text-text-primary shadow-xs',
          pageType !== 'snippets' && 'font-medium',
        )}
      >
        {snippetsLabel}
      </Link>
    </div>
  )
}

const SnippetCreateCard = () => {
  const { t } = useTranslation()

  return (
    <div className="relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg transition-opacity">
      <div className="grow rounded-t-xl p-2">
        <div className="px-6 pb-1 pt-2 text-xs font-medium leading-[18px] text-text-tertiary">{t('createSnippet', { ns: 'app' })}</div>
        <div className="mb-1 flex w-full items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary">
          <span aria-hidden className="i-ri-sticky-note-add-line mr-2 h-4 w-4 shrink-0" />
          {t('newApp.startFromBlank', { ns: 'app' })}
        </div>
        <div className="flex w-full items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary">
          <span aria-hidden className="i-ri-file-upload-line mr-2 h-4 w-4 shrink-0" />
          {t('importDSL', { ns: 'app' })}
        </div>
      </div>
    </div>
  )
}

const SnippetCard = ({
  snippet,
}: {
  snippet: StudioSnippet
}) => {
  return (
    <article className="group relative col-span-1 inline-flex h-[160px] flex-col rounded-xl border border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg">
      {snippet.status && (
        <div className="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-background-default-dimmed px-2 py-1 text-[10px] font-medium uppercase leading-3 text-text-placeholder">
          {snippet.status}
        </div>
      )}
      <div className="flex h-[66px] items-center gap-3 px-[14px] pb-3 pt-[14px]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-divider-regular bg-components-icon-bg-indigo-solid text-xl text-white">
          <span aria-hidden>{snippet.icon}</span>
        </div>
        <div className="w-0 grow py-[1px]">
          <div className="truncate text-sm font-semibold leading-5 text-text-secondary" title={snippet.name}>
            {snippet.name}
          </div>
        </div>
      </div>
      <div className="h-[58px] px-[14px] text-xs leading-normal text-text-tertiary">
        <div className="line-clamp-2" title={snippet.description}>
          {snippet.description}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-1 px-[14px] pb-3 pt-2 text-xs leading-4 text-text-tertiary">
        <span className="truncate">{snippet.author}</span>
        <span>·</span>
        <span className="truncate">{snippet.updatedAt}</span>
        <span>·</span>
        <span className="truncate">{snippet.usage}</span>
      </div>
    </article>
  )
}

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

    const hasMore = isAppsPage ? (hasNextPage ?? true) : false
    let observer: IntersectionObserver | undefined

    if (error) {
      observer?.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
        threshold: 0.1,
      })
      observer.observe(anchorRef.current)
    }

    return () => observer?.disconnect()
  }, [error, fetchNextPage, hasNextPage, isAppsPage, isCurrentWorkspaceDatasetOperator, isFetchingNextPage, isLoading])

  const { run: handleAppSearch } = useDebounceFn((value: string) => {
    setAppKeywords(value)
  }, { wait: 500 })

  const handleKeywordsChange = useCallback((value: string) => {
    if (isAppsPage) {
      setKeywords(value)
      handleAppSearch(value)
      return
    }

    setSnippetKeywords(value)
  }, [handleAppSearch, isAppsPage, setKeywords])

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

  const snippetItems = useMemo<StudioSnippet[]>(() => ([
    {
      id: 'snippet-1',
      name: t('studio.fakeSnippet.name', { ns: 'app' }),
      description: t('studio.fakeSnippet.description', { ns: 'app' }),
      author: t('studio.fakeSnippet.author', { ns: 'app' }),
      updatedAt: t('studio.fakeSnippet.updatedAt', { ns: 'app' }),
      usage: t('studio.fakeSnippet.usage', { ns: 'app' }),
      icon: '🪄',
      status: t('studio.fakeSnippet.status', { ns: 'app' }),
    },
  ]), [t])

  const filteredSnippetItems = useMemo(() => {
    const normalizedKeywords = snippetKeywords.trim().toLowerCase()
    if (!normalizedKeywords)
      return snippetItems

    return snippetItems.filter(item =>
      item.name.toLowerCase().includes(normalizedKeywords)
      || item.description.toLowerCase().includes(normalizedKeywords),
    )
  }, [snippetItems, snippetKeywords])

  const showSkeleton = isAppsPage && (isLoading || (isFetching && data?.pages?.length === 0))
  const hasAnyApp = (data?.pages?.[0]?.total ?? 0) > 0
  const hasAnySnippet = filteredSnippetItems.length > 0
  const currentKeywords = isAppsPage ? keywords : snippetKeywords

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

          {!showSkeleton && !isAppsPage && hasAnySnippet && filteredSnippetItems.map(snippet => (
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
