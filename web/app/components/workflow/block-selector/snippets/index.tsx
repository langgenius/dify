import type { OnNodeAdd } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { useInfiniteScroll } from 'ahooks'
import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from 'react'
import Loading from '@/app/components/base/loading'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import SnippetDetailCard from './snippet-detail-card'
import SnippetEmptyState from './snippet-empty-state'
import SnippetListItem from './snippet-list-item'
import SnippetTagsFilter from './snippet-tags-filter'
import { useInsertSnippet } from './use-insert-snippet'

type SnippetsProps = {
  loading?: boolean
  searchText: string
  insertPayload?: Parameters<OnNodeAdd>[1]
  onInserted?: () => void
}

const LoadingSkeleton = () => {
  return (
    <div className="relative overflow-hidden">
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

const Snippets = ({
  loading = false,
  searchText,
  insertPayload,
  onInserted,
}: SnippetsProps) => {
  const { handleInsertSnippet } = useInsertSnippet()
  const deferredSearchText = useDeferredValue(searchText)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])

  const keyword = deferredSearchText.trim() || undefined

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteSnippetList({
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
  const handleSnippetClick = useCallback(async (snippetId: string) => {
    const inserted = await handleInsertSnippet(snippetId, insertPayload)
    if (inserted)
      onInserted?.()
  }, [handleInsertSnippet, insertPayload, onInserted])

  useInfiniteScroll(
    async () => {
      if (!hasNextPage || isFetchingNextPage)
        return { list: [] }

      await fetchNextPage()
      return { list: [] }
    },
    {
      target: viewportRef,
      isNoMore: () => isNoMore,
      reloadDeps: [isNoMore, isFetchingNextPage, keyword, tagIds],
    },
  )

  const tagsFilter = (
    <div className="flex justify-end border-b border-divider-subtle px-2 py-2">
      <SnippetTagsFilter value={tagIds} onChange={setTagIds} />
    </div>
  )

  if (loading || isLoading || (isFetching && snippets.length === 0)) {
    return (
      <>
        {tagsFilter}
        <LoadingSkeleton />
      </>
    )
  }

  return (
    <>
      {tagsFilter}
      {!snippets.length
        ? (
            <SnippetEmptyState />
          )
        : (
            <ScrollAreaRoot className="relative max-h-120 max-w-125 overflow-hidden">
              <ScrollAreaViewport ref={viewportRef}>
                <ScrollAreaContent className="p-1">
                  {snippets.map((item) => {
                    const row = (
                      <SnippetListItem
                        snippet={item}
                        isHovered={hoveredSnippetId === item.id}
                        onClick={() => handleSnippetClick(item.id)}
                        onMouseEnter={() => setHoveredSnippetId(item.id)}
                        onMouseLeave={() => setHoveredSnippetId(current => current === item.id ? null : current)}
                      />
                    )

                    if (!item.description)
                      return <div key={item.id}>{row}</div>

                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger
                          delay={0}
                          render={row}
                        />
                        <TooltipContent
                          placement="left-start"
                          className="bg-transparent! p-0!"
                        >
                          <SnippetDetailCard snippet={item} />
                        </TooltipContent>
                      </Tooltip>
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
          )}
    </>
  )
}

export default memo(Snippets)
