import type { CreateSnippetDialogPayload } from '../create-snippet-dialog'
import type { Snippet as SnippetDetail } from '@/types/snippet'
import {
  memo,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { useCreateSnippetMutation } from '@/service/use-snippets'
import { cn } from '@/utils/classnames'
import CreateSnippetDialog from '../create-snippet-dialog'
import { BlockEnum } from '../types'
import SnippetDetailCard from './snippet-detail-card'
import SnippetListItem from './snippet-list-item'

type SnippetsProps = {
  loading?: boolean
  searchText: string
}

type StaticSnippet = SnippetDetail & {
  relatedBlocks?: BlockEnum[]
}

const STATIC_SNIPPETS: StaticSnippet[] = [
  {
    id: 'customer-review',
    name: 'Customer Review',
    description: 'Collects customer review context, classifies request intent, and routes the workflow through the right generation branch.',
    author: 'Evan',
    type: 'group',
    is_published: true,
    version: '1.0.0',
    use_count: 128,
    input_fields: [],
    created_at: 1742889600,
    updated_at: 1742976000,
    icon_info: {
      icon_type: 'emoji',
      icon: '🧾',
      icon_background: '#FFEAD5',
      icon_url: '',
    },
    relatedBlocks: [
      BlockEnum.LLM,
      BlockEnum.Code,
      BlockEnum.KnowledgeRetrieval,
      BlockEnum.QuestionClassifier,
      BlockEnum.IfElse,
    ],
  },
] as const

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
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null)
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)

  const snippets = useMemo(() => {
    return STATIC_SNIPPETS.map(item => ({
      ...item,
    }))
  }, [])

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

  const filteredSnippets = useMemo(() => {
    const normalizedSearch = deferredSearchText.trim().toLowerCase()
    if (!normalizedSearch)
      return snippets

    return snippets.filter(item => item.name.toLowerCase().includes(normalizedSearch))
  }, [deferredSearchText, snippets])

  if (loading)
    return <LoadingSkeleton />

  if (!filteredSnippets.length) {
    return (
      <>
        <div className="flex min-h-[480px] flex-col items-center justify-center gap-2 px-4">
          <span className="i-custom-vender-line-others-search-menu h-8 w-8 text-text-tertiary" />
          <div className="text-text-secondary system-sm-regular">
            {t('tabs.noSnippetsFound', { ns: 'workflow' })}
          </div>
          <Button
            variant="secondary-accent"
            size="small"
            onClick={() => setIsCreateSnippetDialogOpen(true)}
          >
            {t('tabs.createSnippet', { ns: 'workflow' })}
          </Button>
        </div>
        <CreateSnippetDialog
          isOpen={isCreateSnippetDialogOpen}
          isSubmitting={isCreatingSnippet || createSnippetMutation.isPending}
          onClose={handleCloseCreateSnippetDialog}
          onConfirm={handleCreateSnippet}
        />
      </>
    )
  }

  return (
    <div className="max-h-[480px] max-w-[500px] overflow-y-auto p-1">
      {filteredSnippets.map((item) => {
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
    </div>
  )
}

export default memo(Snippets)
