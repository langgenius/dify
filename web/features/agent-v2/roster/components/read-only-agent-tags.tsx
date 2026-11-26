import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { TagTriggerContent } from '@/features/tag-management/tag-trigger-content'

export function ReadOnlyAgentTags({ agent }: { agent: Pick<AgentAppPartial, 'name' | 'tags'> }) {
  const { t } = useTranslation(['common'])
  const tags = agent.tags ?? []
  const names = tags.map((tag) => tag.name)
  const emptyLabel = t(($) => $['tag.noTag'])
  const chips = <TagTriggerContent tags={names} emptyLabel={emptyLabel} />

  if (!tags.length) {
    return (
      <span className="flex p-1">
        {chips}
        <span className="sr-only">{emptyLabel}</span>
      </span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${names.join(', ')}: ${agent.name}`}
        className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-0.5 rounded-lg p-1 hover:bg-state-base-hover data-popup-open:bg-state-base-hover"
      >
        {chips}
        <span aria-hidden className="i-ri-arrow-down-s-line size-3.5 shrink-0 text-text-tertiary" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`${t(($) => $['tag.tags'])}: ${agent.name}`}
        className="max-h-(--available-height) max-w-[min(20rem,var(--available-width))] overflow-y-auto p-2"
      >
        <ul className="space-y-1 px-1 system-sm-regular wrap-anywhere text-text-secondary">
          {tags.map((tag) => (
            <li key={tag.id}>{tag.name}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
