import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { TagSelector } from '@/features/tag-management/components/tag-selector'

type AppCardTagsProps = {
  appId: string
  appName: string
  tags: Tag[]
  canBindOrUnbindTags?: boolean
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const AppCardTags = ({
  appId,
  appName,
  tags,
  canBindOrUnbindTags,
  onOpenTagManagement = () => {},
  onTagsChange,
}: AppCardTagsProps) => {
  return (
    <TagSelector
      type="app"
      targetId={appId}
      contextLabel={appName}
      value={tags}
      canBindOrUnbindTags={canBindOrUnbindTags}
      onOpenTagManagement={onOpenTagManagement}
      onTagsChange={onTagsChange}
    />
  )
}
