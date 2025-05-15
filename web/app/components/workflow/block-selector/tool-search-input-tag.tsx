import { memo } from 'react'
import { RiPriceTag3Line } from '@remixicon/react'
import TagsFilter from '@/app/components/plugins/marketplace/search-box/tags-filter'
import cn from '@/utils/classnames'

type ToolSearchInputTagProps = {
  tags: string[]
  onTagsChange: (tags: string[]) => void
}
const ToolSearchInputTag = ({
  tags,
  onTagsChange,
}: ToolSearchInputTagProps) => {
  return (
    <TagsFilter
      tags={tags}
      onTagsChange={onTagsChange}
      size='large'
      className={cn(
        'p-0',
        tags.length && 'px-0.5',
      )}
      triggerClassName={cn(
        'p-0',
        tags.length && 'px-0.5',
      )}
      emptyTrigger={
        <div className='flex h-7 w-[34px] items-center justify-center'>
          <RiPriceTag3Line className='h-4 w-4 text-text-tertiary' />
        </div>
      }
    />
  )
}

export default memo(ToolSearchInputTag)
