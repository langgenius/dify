import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { consoleQuery } from '@/service/client'
import { TagSelector } from './tag-selector'

type SkillCardTagsProps = {
  skillId: string
  tags: string[]
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const SkillCardTags = ({
  skillId,
  tags,
  onOpenTagManagement = () => {},
  onTagsChange,
}: SkillCardTagsProps) => {
  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type: 'skill',
        },
      },
    }),
  )
  const selectedTags = useMemo<Tag[]>(() => {
    const selectedTagNames = new Set(tags)
    return tagList.filter((tag) => tag.type === 'skill' && selectedTagNames.has(tag.name))
  }, [tagList, tags])

  return (
    <div className="group/tag-area relative w-full min-w-0 overflow-hidden">
      <TagSelector
        type="skill"
        targetId={skillId}
        value={selectedTags}
        canBindOrUnbindTags
        className="focus-visible:ring-inset"
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onTagsChange}
      />
      <div className="pointer-events-none absolute top-0 right-0 h-full w-20 bg-tag-selector-mask-bg group-focus-within/tag-area:hidden group-hover/tag-area:hidden" />
    </div>
  )
}
