'use client'

import type { SnippetListItem } from '@/types/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import useDocumentTitle from '@/hooks/use-document-title'
import dynamic from '@/next/dynamic'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import CreatorsFilter from '../apps/creators-filter'
import Empty from '../apps/empty'
import Footer from '../apps/footer'
import SnippetCard from './components/snippet-card'
import SnippetCreateButton from './components/snippet-create-button'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import { useSnippetsQueryState } from './hooks/use-snippets-query-state'

const TagManagementModal = dynamic(() => import('@/features/tag-management/components/tag-management-modal').then(mod => mod.TagManagementModal), {
  ssr: false,
})

const SNIPPET_CARD_SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']

type SnippetCardSkeletonProps = {
  count: number
}

const SnippetCardSkeleton = ({ count }: SnippetCardSkeletonProps) => {
  return (
    <>
      {SNIPPET_CARD_SKELETON_KEYS.slice(0, count).map(key => (
        <div
          key={key}
          className="col-span-1 h-55 animate-pulse rounded-xl bg-background-default-lighter"
        />
      ))}
    </>
  )
}

const SnippetList = () => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  // eslint-disable-next-line react/use-state -- custom URL query hook, not React.useState
  const {
    query: { tagIDs, keywords, creatorIDs },
    setKeywords,
    setTagIDs,
    setCreatorIDs,
  } = useSnippetsQueryState()
  const debouncedKeywords = useDebounce(keywords, { wait: SNIPPET_LIST_SEARCH_DEBOUNCE_MS })
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)

  useDocumentTitle(t('tabs.snippets', { ns: 'workflow' }))

  const snippetListQuery = useMemo(() => ({
    page: 1,
    limit: 30,
    keyword: debouncedKeywords,
    ...(tagIDs.length ? { tag_ids: tagIDs } : {}),
    ...(creatorIDs.length ? { creator_ids: creatorIDs } : {}),
  }), [creatorIDs, debouncedKeywords, tagIDs])

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
  } = useInfiniteSnippetList(snippetListQuery, {
    enabled: !isCurrentWorkspaceDatasetOperator,
  })

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
  }, [error, fetchNextPage, hasNextPage, isCurrentWorkspaceDatasetOperator, isFetchingNextPage, isLoading])

  const pages = useMemo(() => data?.pages ?? [], [data?.pages])
  const snippets = useMemo<SnippetListItem[]>(() => pages.flatMap(({ data: pageSnippets }) => pageSnippets), [pages])
  const hasAnySnippet = (pages[0]?.total ?? 0) > 0
  const showSkeleton = isLoading || (isFetching && pages.length === 0)

  return (
    <div ref={containerRef} className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background-body px-12 pt-7 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <CreatorsFilter
            value={creatorIDs}
            onChange={setCreatorIDs}
          />
          <TagFilter type="snippet" value={tagIDs} onChange={setTagIDs} onOpenTagManagement={() => setShowTagManagementModal(true)} />
          <div className="relative w-50">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder" />
            <Input
              className={cn('pl-6.5', keywords && 'pr-6.5')}
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder={t('tabs.searchSnippets', { ns: 'workflow' })}
            />
            {!!keywords && (
              <button
                type="button"
                aria-label={t('operation.clear', { ns: 'common' })}
                className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center text-components-input-text-placeholder hover:text-components-input-text-filled"
                onClick={() => setKeywords('')}
              >
                <span aria-hidden className="i-ri-close-circle-fill size-4" />
              </button>
            )}
          </div>
        </div>
        {(isCurrentWorkspaceEditor || isLoadingCurrentWorkspace) && (
          <SnippetCreateButton />
        )}
      </div>
      <div className={cn(
        'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
        !hasAnySnippet && 'overflow-hidden',
      )}
      >
        {showSkeleton
          ? <SnippetCardSkeleton count={6} />
          : hasAnySnippet
            ? snippets.map(snippet => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  onOpenTagManagement={() => setShowTagManagementModal(true)}
                  onRefresh={refetch}
                  onTagsChange={refetch}
                />
              ))
            : <Empty message={t('tabs.noSnippetsFound', { ns: 'workflow' })} />}
        {isFetchingNextPage && (
          <SnippetCardSkeleton count={3} />
        )}
      </div>
      {!systemFeatures.branding.enabled && (
        <Footer />
      )}
      <div ref={anchorRef} className="h-0"> </div>
      <TagManagementModal
        type="snippet"
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={refetch}
      />
    </div>
  )
}

export default SnippetList
