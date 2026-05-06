import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import TagSelector from '@/app/components/base/tag-management/selector'

type TagAreaProps = {
  dataset: DataSet
  isHoveringTagSelector: boolean
  onClick: (e: React.MouseEvent) => void
  onOpenTagManagement?: () => void
}

const TagArea = React.forwardRef<HTMLDivElement, TagAreaProps>(({
  dataset,
  isHoveringTagSelector,
  onClick,
  onOpenTagManagement = () => {},
}, ref) => (
  <div
    className={cn('relative w-full px-3', !dataset.embedding_available && 'opacity-30')}
    onClick={onClick}
  >
    <div
      ref={ref}
      className="w-full"
    >
      <TagSelector
        position="bl"
        type="knowledge"
        targetID={dataset.id}
        value={dataset.tags.map(tag => tag.id)}
        selectedTags={dataset.tags}
        onOpenTagManagement={onOpenTagManagement}
      />
    </div>
    <div
      className={cn(
        'absolute top-0 right-0 z-5 h-full w-20 bg-tag-selector-mask-bg group-hover:bg-tag-selector-mask-hover-bg',
        isHoveringTagSelector && 'hidden',
      )}
    />
  </div>
))
TagArea.displayName = 'TagArea'

export default TagArea
