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
        placement="bottom-start"
        type="knowledge"
        targetId={datasetId}
        value={tags}
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onTagsChange}
      />
    </div>
    <div
      className="absolute top-0 right-0 h-full w-20 bg-tag-selector-mask-bg group-focus-within/tag-area:hidden group-hover:bg-tag-selector-mask-hover-bg group-hover/tag-area:hidden"
    />
  </div>
)
