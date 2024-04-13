import type { FC } from 'react'
import cn from 'classnames'
import { useDebounceFn } from 'ahooks'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import type { Tag } from '@/app/components/base/tag-management/constant'

type TagItemProps = {
  className?: string
  tag: Tag
  onRemove: () => void
}
const TagItem: FC<TagItemProps> = ({
  className,
  tag,
  onRemove,
}) => {
  const { run: handleRemove } = useDebounceFn(() => {
    onRemove()
  }, { wait: 500 })

  return (
    <div className={cn('group/tag flex items-center px-1 border bg-white border-gray-200 rounded-[5px]', className)} title={tag.name}>
      <div className='text-gray-500 text-xs leading-4.5 truncate'>
        {tag.name}
      </div>
      <div className='hidden group-hover/tag:!inline-flex shrink-0 items-center bg-white cursor-pointer'>
        <XClose className='w-3 h-3 text-gray-500' onClick={handleRemove} />
      </div>
    </div>
  )
}

export default TagItem
