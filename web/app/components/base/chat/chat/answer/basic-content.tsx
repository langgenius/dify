import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { memo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
import { cn } from '@/utils/classnames'

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
    return <Markdown content={annotation?.logAnnotation.content || ''} />

  // Preserve Windows UNC paths and similar backslash-heavy strings by
  // wrapping them in inline code so Markdown renders backslashes verbatim.
  let displayContent = content
  if (typeof content === 'string' && /^\\\\\S.*/.test(content) && !/^`.*`$/.test(content)) {
    displayContent = `\`${content}\``
  }

  return (
    <Markdown
      className={cn(
        item.isError && '!text-[#F04438]',
      )}
      content={displayContent}
    />
  )
}

export default memo(BasicContent)
