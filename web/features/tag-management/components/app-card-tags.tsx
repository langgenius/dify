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
        placement="bottom-start"
        type="app"
        targetId={appId}
        value={tags}
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onTagsChange}
      />
      <div className="pointer-events-none absolute top-0 right-0 h-full w-20 bg-tag-selector-mask-bg group-focus-within/tag-area:hidden group-hover:bg-tag-selector-mask-hover-bg group-hover/tag-area:hidden" />
    </div>
  )
}
