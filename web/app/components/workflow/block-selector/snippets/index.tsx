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
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from 'react'
import Loading from '@/app/components/base/loading'
import { useInfiniteSnippetList } from '@/service/use-snippets'
import CreateSnippetDialog from '../../create-snippet-dialog'
import SnippetDetailCard from './snippet-detail-card'
import SnippetEmptyState from './snippet-empty-state'
import SnippetListItem from './snippet-list-item'
import { useCreateSnippet } from './use-create-snippet'
import { useInsertSnippet } from './use-insert-snippet'

type SnippetsProps = {
  loading?: boolean
  searchText: string
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
            <div className="my-1 h-6 w-6 shrink-0 rounded-lg border-[0.5px] border-effects-icon-border bg-text-quaternary" />
            <div className="min-w-0 flex-1 px-1 py-1">
              <div className="h-2 w-[200px] rounded-[2px] bg-text-quaternary" />
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
}: SnippetsProps) => {
  const {
    createSnippetMutation,
    handleCloseCreateSnippetDialog,
    handleCreateSnippet,
    handleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen,
    isCreatingSnippet,
  } = useCreateSnippet()
  const { handleInsertSnippet } = useInsertSnippet()
  const deferredSearchText = useDeferredValue(searchText)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null)

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
    is_published: true,
  })

  const snippets = useMemo(() => {
    return (data?.pages ?? []).flatMap(({ data }) => data)
  }, [data?.pages])

  const isNoMore = hasNextPage === false

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
      reloadDeps: [isNoMore, isFetchingNextPage, keyword],
    },
  )

  if (loading || isLoading || (isFetching && snippets.length === 0))
    return <LoadingSkeleton />

  return (
    <>
      {!snippets.length
        ? (
            <SnippetEmptyState onCreate={handleOpenCreateSnippetDialog} />
          )
        : (
            <ScrollAreaRoot className="relative max-h-[480px] max-w-[500px] overflow-hidden">
              <ScrollAreaViewport ref={viewportRef}>
                <ScrollAreaContent className="p-1">
                  {snippets.map((item) => {
                    const row = (
                      <SnippetListItem
                        snippet={item}
                        isHovered={hoveredSnippetId === item.id}
                        onClick={() => handleInsertSnippet(item.id)}
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
                          variant="plain"
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
      <CreateSnippetDialog
        isOpen={isCreateSnippetDialogOpen}
        isSubmitting={isCreatingSnippet || createSnippetMutation.isPending}
        onClose={handleCloseCreateSnippetDialog}
        onConfirm={handleCreateSnippet}
      />
    </>
  )
}

export default memo(Snippets)
