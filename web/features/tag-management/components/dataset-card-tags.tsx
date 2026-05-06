import type { MouseEvent } from 'react'
import type { Tag } from '@/contract/console/tags'
import { cn } from '@langgenius/dify-ui/cn'
import { TagSelector } from '@/features/tag-management/components/tag-selector'

type DatasetCardTagsProps = {
  datasetId: string
  embeddingAvailable: boolean
  tags: Tag[]
  onClick: (e: MouseEvent) => void
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const DatasetCardTags = ({
  datasetId,
  embeddingAvailable,
  tags,
  onClick,
  onOpenTagManagement = () => {},
  onTagsChange,
}: DatasetCardTagsProps) => (
  <div
    className={cn('group/tag-area relative w-full px-3', !embeddingAvailable && 'opacity-30')}
    onClick={onClick}
  >
    <div className="w-full">
      <TagSelector
        position="bl"
        type="knowledge"
        targetId={datasetId}
        selectedTagIds={tags.map(tag => tag.id)}
        selectedTags={tags}
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onTagsChange}
      />
    </div>
    <div
      className="absolute top-0 right-0 z-5 h-full w-20 bg-tag-selector-mask-bg group-hover:bg-tag-selector-mask-hover-bg group-hover/tag-area:hidden"
    />
  </div>
)
