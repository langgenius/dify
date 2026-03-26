import type { CreateSnippetDialogPayload } from '../../create-snippet-dialog'
import { useInfiniteScroll } from 'ahooks'
import {
  memo,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/app/components/base/ui/scroll-area'
import { toast } from '@/app/components/base/ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import {
  useCreateSnippetMutation,
  useInfiniteSnippetList,
} from '@/service/use-snippets'
import { cn } from '@/utils/classnames'
import CreateSnippetDialog from '../../create-snippet-dialog'
import SnippetDetailCard from './snippet-detail-card'
import SnippetEmptyState from './snippet-empty-state'
import SnippetListItem from './snippet-list-item'

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
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-components-panel-bg-transparent to-background-default-subtle" />
    </div>
  )
}

const Snippets = ({
  loading = false,
  searchText,
}: SnippetsProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const createSnippetMutation = useCreateSnippetMutation()
  const deferredSearchText = useDeferredValue(searchText)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null)
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)

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

  const handleCloseCreateSnippetDialog = () => {
    setIsCreateSnippetDialogOpen(false)
  }

  const handleCreateSnippet = async ({
    name,
    description,
    icon,
    graph,
  }: CreateSnippetDialogPayload) => {
    setIsCreatingSnippet(true)

    try {
      const snippet = await createSnippetMutation.mutateAsync({
        body: {
          name,
          description: description || undefined,
          icon_info: {
            icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
            icon_type: icon.type,
            icon_background: icon.type === 'emoji' ? icon.background : undefined,
            icon_url: icon.type === 'image' ? icon.url : undefined,
          },
        },
      })

      await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId: snippet.id },
        body: { graph },
      })

      toast.success(t('snippet.createSuccess', { ns: 'workflow' }))
      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('createFailed', { ns: 'snippet' }))
    }
    finally {
      setIsCreatingSnippet(false)
    }
  }

  if (loading || isLoading || (isFetching && snippets.length === 0))
    return <LoadingSkeleton />

  return (
    <>
      {!snippets.length
        ? (
            <SnippetEmptyState onCreate={() => setIsCreateSnippetDialogOpen(true)} />
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
                          popupClassName="!bg-transparent !p-0"
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
