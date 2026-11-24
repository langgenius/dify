import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { TagSelector } from '@/features/tag-management/tag-selector'
import { TagTriggerContent } from '@/features/tag-management/tag-trigger-content'

export function AgentRosterTags({
  id,
  name,
  tags,
  canEdit,
  onOpenTagManagement,
}: Pick<AgentAppPartial, 'id' | 'name' | 'tags'> & {
  canEdit: boolean
  onOpenTagManagement: () => void
}) {
  const assignedTags = tags ?? []
  if (!canEdit) return <ReadOnlyAgentTags name={name} tags={assignedTags} />

  return (
    <TagSelector
      type="agent"
      targetId={id}
      contextLabel={name}
      value={assignedTags}
      canBindOrUnbindTags
      onOpenTagManagement={onOpenTagManagement}
    />
  )
}

function ReadOnlyAgentTags({
  name,
  tags,
}: Pick<AgentAppPartial, 'name'> & { tags: NonNullable<AgentAppPartial['tags']> }) {
  const { t } = useTranslation(['common'])
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
        aria-label={`${names.join(', ')}: ${name}`}
        className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-0.5 rounded-lg p-1 hover:bg-state-base-hover data-popup-open:bg-state-base-hover"
      >
        {chips}
        <span aria-hidden className="i-ri-arrow-down-s-line size-3.5 shrink-0 text-text-tertiary" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`${t(($) => $['tag.tags'])}: ${name}`}
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
