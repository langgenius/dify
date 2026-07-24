import type { Tag } from '@/app/components/base/tag-management/constant'
import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import TagSelector from '@/app/components/base/tag-management/selector'
import { cn } from '@/utils/classnames'

type TagAreaProps = {
  dataset: DataSet
  tags: Tag[]
  setTags: (tags: Tag[]) => void
  onSuccess?: () => void
  isHoveringTagSelector: boolean
  onClick: (e: React.MouseEvent) => void
}

const TagArea = React.forwardRef<HTMLDivElement, TagAreaProps>(({
  dataset,
  tags,
  setTags,
  onSuccess,
  isHoveringTagSelector,
  onClick,
}, ref) => (
  <div
    className={cn('relative w-full px-3', !dataset.embedding_available && 'opacity-30')}
    onClick={onClick}
  >
    <div
      ref={ref}
      className={cn(
        'invisible w-full group-hover:visible',
        tags.length > 0 && 'visible',
      )}
    >
      <TagSelector
        position="bl"
        type="knowledge"
        targetID={dataset.id}
        value={tags.map(tag => tag.id)}
        selectedTags={tags}
        onCacheUpdate={setTags}
        onChange={onSuccess}
      />
    </div>
    <div
      className={cn(
        'absolute right-0 top-0 z-[5] h-full w-20 bg-tag-selector-mask-bg group-hover:bg-tag-selector-mask-hover-bg',
        isHoveringTagSelector && 'hidden',
      )}
    />
  </div>
))
TagArea.displayName = 'TagArea'

export default TagArea
