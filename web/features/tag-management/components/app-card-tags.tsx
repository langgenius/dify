import type { Tag } from '@/contract/console/tags'
import { TagSelector } from '@/features/tag-management/components/tag-selector'

type AppCardTagsProps = {
  appId: string
  tags: Tag[]
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const AppCardTags = ({
  appId,
  tags,
  onOpenTagManagement = () => {},
  onTagsChange,
}: AppCardTagsProps) => {
  return (
    <div className="group/tag-area relative min-w-0 overflow-hidden">
      <TagSelector
        position="bl"
        type="app"
        targetId={appId}
        selectedTagIds={tags.map(tag => tag.id)}
        selectedTags={tags}
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onTagsChange}
      />
      <div className="pointer-events-none absolute top-0 right-0 z-5 h-full w-20 bg-tag-selector-mask-bg group-hover:bg-tag-selector-mask-hover-bg group-hover/tag-area:hidden" />
    </div>
  )
}
