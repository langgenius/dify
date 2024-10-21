import type { FC } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../../types'
import { Markdown } from '@/app/components/base/markdown'
import cn from '@/utils/classnames'

type BasicContentProps = {
  item: ChatItem
}
const BasicContent: FC<BasicContentProps> = ({
  item,
}) => {
  const {
    annotation,
    content,
  } = item

  if (annotation?.logAnnotation)
    return <Markdown content={annotation?.logAnnotation.content || ''} className='px-2 py-1' />

  return (
    <Markdown
      className={cn(
        'px-2 py-1',
        item.isError && '!text-[#F04438]',
      )}
      content={content}
    />
  )
}

export default memo(BasicContent)
