import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { TagSelector } from '@/features/tag-management/components/tag-selector'

type DatasetCardTagsProps = {
  datasetId: string
  embeddingAvailable: boolean
  tags: Tag[]
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
  canBindOrUnbindTags?: boolean
}

export const DatasetCardTags = ({
  datasetId,
  embeddingAvailable,
  tags,
  onOpenTagManagement = () => {},
  onTagsChange,
  canBindOrUnbindTags,
}: DatasetCardTagsProps) => (
  <TagSelector
    type="knowledge"
    targetId={datasetId}
    value={tags}
    onOpenTagManagement={onOpenTagManagement}
    onTagsChange={onTagsChange}
    canBindOrUnbindTags={canBindOrUnbindTags}
    className={cn('mx-3 w-auto', !embeddingAvailable && 'opacity-30')}
    onClick={(event) => event.stopPropagation()}
  />
)
