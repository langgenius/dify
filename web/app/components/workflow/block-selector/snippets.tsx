import type { ReactNode } from 'react'
import {
  memo,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  SearchMenu,
} from '@/app/components/base/icons/src/vender/line/others'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'

type SnippetsProps = {
  loading?: boolean
  searchText: string
}

type StaticSnippet = {
  id: string
  badge: string
  badgeClassName: string
  title: string
  description: string
  author?: string
  relatedBlocks?: BlockEnum[]
}

const STATIC_SNIPPETS: StaticSnippet[] = [
  {
    id: 'customer-review',
    badge: 'CR',
    title: 'Customer Review',
    description: 'Customer Review Description',
    author: 'Evan',
    relatedBlocks: [
      BlockEnum.LLM,
      BlockEnum.Code,
      BlockEnum.KnowledgeRetrieval,
      BlockEnum.QuestionClassifier,
      BlockEnum.IfElse,
    ],
    badgeClassName: 'bg-gradient-to-br from-orange-500 to-rose-500',
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

const SnippetBadge = ({
  badge,
  badgeClassName,
}: Pick<StaticSnippet, 'badge' | 'badgeClassName'>) => {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold uppercase text-white shadow-[0px_3px_10px_-2px_rgba(9,9,11,0.08),0px_2px_4px_-2px_rgba(9,9,11,0.06)]',
        badgeClassName,
      )}
    >
      {badge}
    </div>
  )
}

const SnippetDetailCard = ({
  author,
  description,
  relatedBlocks = [],
  title,
  triggerBadge,
}: {
  author?: string
  description?: string
  relatedBlocks?: BlockEnum[]
  title: string
  triggerBadge: ReactNode
}) => {
  return (
    <div className="w-[224px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 pb-4 pt-3 shadow-lg backdrop-blur-[5px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          {triggerBadge}
          <div className="text-text-primary system-md-medium">{title}</div>
        </div>
        {!!description && (
          <div className="w-[200px] text-text-secondary system-xs-regular">
            {description}
          </div>
        )}
        {!!relatedBlocks.length && (
          <div className="flex items-center gap-0.5 pt-1">
            {relatedBlocks.map(block => (
              <BlockIcon
                key={block}
                type={block}
                size="sm"
              />
            ))}
          </div>
        )}
      </div>
      {!!author && (
        <div className="pt-3 text-text-tertiary system-xs-regular">
          {author}
        </div>
      )}
    </div>
  )
}

const Snippets = ({
  loading = false,
  searchText,
}: SnippetsProps) => {
  const { t } = useTranslation()
  const deferredSearchText = useDeferredValue(searchText)
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null)

  const snippets = useMemo(() => {
    return STATIC_SNIPPETS.map(item => ({
      ...item,
    }))
  }, [])

  const filteredSnippets = useMemo(() => {
    const normalizedSearch = deferredSearchText.trim().toLowerCase()
    if (!normalizedSearch)
      return snippets

    return snippets.filter(item => item.title.toLowerCase().includes(normalizedSearch))
  }, [deferredSearchText, snippets])

  if (loading)
    return <LoadingSkeleton />

  if (!filteredSnippets.length) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center gap-2 px-4">
        <SearchMenu className="h-8 w-8 text-text-tertiary" />
        <div className="text-text-secondary system-sm-regular">
          {t('tabs.noSnippetsFound', { ns: 'workflow' })}
        </div>
        <Button
          variant="secondary-accent"
          size="small"
          onClick={(e) => {
            e.preventDefault()
          }}
        >
          {t('tabs.createSnippet', { ns: 'workflow' })}
        </Button>
      </div>
    )
  }

  return (
    <div className="max-h-[480px] max-w-[500px] overflow-y-auto p-1">
      {filteredSnippets.map((item) => {
        const badge = (
          <SnippetBadge
            badge={item.badge}
            badgeClassName={item.badgeClassName}
          />
        )

        const row = (
          <div
            className={cn(
              'flex h-8 items-center gap-2 rounded-lg px-3',
              hoveredSnippetId === item.id && 'bg-background-default-hover',
            )}
            onMouseEnter={() => setHoveredSnippetId(item.id)}
            onMouseLeave={() => setHoveredSnippetId(current => current === item.id ? null : current)}
          >
            {badge}
            <div className="min-w-0 text-text-secondary system-sm-medium">
              {item.title}
            </div>
            {hoveredSnippetId === item.id && item.author && (
              <div className="ml-auto text-text-tertiary system-xs-regular">
                {item.author}
              </div>
            )}
          </div>
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
              <SnippetDetailCard
                author={item.author}
                description={item.description}
                relatedBlocks={item.relatedBlocks}
                title={item.title}
                triggerBadge={badge}
              />
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default memo(Snippets)
