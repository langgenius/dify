import type { OnNodeAdd } from '../../types'
import type { PublishedSnippetListItem } from './snippet-detail-card'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useInfiniteScroll } from 'ahooks'
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import { BlockSelectorPreviewCardContent } from '../preview-card'
import SnippetDetailCard from './snippet-detail-card'
import SnippetEmptyState from './snippet-empty-state'
import SnippetListItem from './snippet-list-item'
import SnippetTagsFilter from './snippet-tags-filter'
import { useInsertSnippet } from './use-insert-snippet'

type SnippetsProps = {
  searchText: string
  onSearchTextChange?: (searchText: string) => void
  insertPayload?: Parameters<OnNodeAdd>[1]
  onInserted?: () => void
}

const LoadingSkeleton = () => {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-label={t(($) => $.loading, { ns: 'common' })}
      className="relative overflow-hidden"
    >
      <div className="p-1">
        {['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4'].map((key, index) => (
          <div
            key={key}
            className={cn(
              'flex items-center gap-1 px-3 py-1 opacity-20',
              index === 3 && 'opacity-10',
            )}
          >
            <div className="min-w-0 flex-1 px-1 py-1">
              <div className="h-2 w-50 rounded-xs bg-text-quaternary" />
            </div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-components-panel-bg-transparent to-background-default-subtle" />
    </div>
  )
}

const Snippets = ({ searchText, onSearchTextChange, insertPayload, onInserted }: SnippetsProps) => {
  const { t } = useTranslation()
  const { handleInsertSnippet } = useInsertSnippet()
  const deferredSearchText = useDeferredValue(searchText)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const previewCardHandle = useMemo(() => createPreviewCardHandle<PublishedSnippetListItem>(), [])

  const keyword = deferredSearchText.trim() || undefined

  const { data, isLoading, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useInfiniteSnippetList({
      page: 1,
      limit: 30,
      keyword,
      ...(tagIds.length ? { tag_ids: tagIds } : {}),
      is_published: true,
    })

  const snippets = useMemo(() => {
    return (data?.pages ?? []).flatMap(({ data }) => data)
  }, [data?.pages])

  const isNoMore = hasNextPage === false
  const handleSnippetClick = useCallback(
    async (snippetId: string) => {
      const inserted = await handleInsertSnippet(snippetId, insertPayload)
      if (inserted) onInserted?.()
    },
    [handleInsertSnippet, insertPayload, onInserted],
  )

  useInfiniteScroll(
    async () => {
      if (!hasNextPage || isFetchingNextPage) return { list: [] }

      await fetchNextPage()
      return { list: [] }
    },
    {
      target: viewportRef,
      isNoMore: () => isNoMore,
      reloadDeps: [isNoMore, isFetchingNextPage, keyword, tagIds],
    },
  )

  const filter = (
    <div className="p-2">
      <div className="flex items-center rounded-lg border border-transparent bg-components-input-bg-normal focus-within:border-components-input-border-active hover:border-components-input-border-hover">
        <div className="flex h-8 min-w-0 grow items-center pr-2 pl-2">
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={t(($) => $['tabs.searchSnippets'], { ns: 'workflow' })}
            name="query"
            autoComplete="off"
            value={searchText}
            placeholder={t(($) => $['tabs.searchSnippets'], { ns: 'workflow' })}
            className={cn(
              'mr-1 ml-1.5 inline-block min-w-0 grow appearance-none bg-transparent system-sm-regular text-components-input-text-filled outline-hidden placeholder:text-components-input-text-placeholder',
              '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
              searchText && 'mr-2',
            )}
            onChange={(event) => onSearchTextChange?.(event.target.value)}
          />
          {!!searchText && (
            <Button
              variant="ghost"
              size="small"
              aria-label={t(($) => $['tabs.clearSnippetSearch'], { ns: 'workflow' })}
              className="size-6 min-h-0 shrink-0 p-0 focus-visible:ring-inset"
              onClick={() => onSearchTextChange?.('')}
            >
              <span className="i-ri-close-line size-4 text-text-tertiary" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="mx-0 mr-0.5 h-3.5 w-px bg-divider-regular" />
        <SnippetTagsFilter embedded value={tagIds} onChange={setTagIds} />
      </div>
    </div>
  )

  const content =
    isLoading || (isFetching && snippets.length === 0) ? (
      <LoadingSkeleton />
    ) : !snippets.length ? (
      <SnippetEmptyState />
    ) : (
      <ScrollAreaRoot className="relative max-h-120 max-w-125 overflow-hidden">
        <ScrollAreaViewport ref={viewportRef}>
          <ScrollAreaContent className="p-1">
            {snippets.map((item) => {
              const row = (
                <SnippetListItem snippet={item} onClick={() => handleSnippetClick(item.id)} />
              )

              return (
                <PreviewCardTrigger
                  key={item.id}
                  delay={0}
                  closeDelay={150}
                  handle={previewCardHandle}
                  payload={item}
                  render={row}
                />
              )
            })}
            {isFetchingNextPage && (
              <div className="flex justify-center px-3 py-2">
                <Loading />
              </div>
            )}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    )

  return (
    <>
      {filter}
      <div className="border-t border-divider-subtle">{content}</div>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => {
          if (!payload) return null

          return (
            <BlockSelectorPreviewCardContent>
              <SnippetDetailCard snippet={payload as PublishedSnippetListItem} />
            </BlockSelectorPreviewCardContent>
          )
        }}
      </PreviewCard>
    </>
  )
}

export default memo(Snippets)
