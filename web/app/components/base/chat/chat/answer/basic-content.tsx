import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
import { resolveKnowledgeCitationLinks } from './knowledge-citation-links'

type BasicContentProps = {
  item: ChatItem
}
const BasicContent: FC<BasicContentProps> = ({ item }) => {
  const { annotation, content } = item

  if (annotation?.logAnnotation) {
    return (
      <Markdown
        content={annotation?.logAnnotation.content || ''}
        data-testid="basic-content-markdown"
      />
    )
  }

  // Preserve Windows UNC paths and similar backslash-heavy strings by
  // wrapping them in inline code so Markdown renders backslashes verbatim.
  let displayContent = content
  if (typeof content === 'string' && /^\\\\\S.*/.test(content) && !/^`.*`$/.test(content)) {
    displayContent = `\`${content}\``
  }
  // Workflow AgentV2 answers use the ordinary chat renderer. Resolve only
  // server-issued receipts here as well as in Agent App's activity renderer.
  if (typeof displayContent === 'string')
    displayContent = resolveKnowledgeCitationLinks(displayContent, item.citation)

  return (
    <Markdown
      className={cn(item.isError && 'text-[#F04438]!')}
      content={displayContent}
      data-testid="basic-content-markdown"
    />
  )
}

export default memo(BasicContent)
