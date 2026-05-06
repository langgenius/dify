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
    <TagSelector
      position="bl"
      type="app"
      targetId={appId}
      selectedTagIds={tags.map(tag => tag.id)}
      selectedTags={tags}
      onOpenTagManagement={onOpenTagManagement}
      onTagsChange={onTagsChange}
    />
  )
}
