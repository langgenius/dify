import * as React from 'react'
import { Markdown } from '@/app/components/base/markdown'

type SubmittedContentProps = {
  content: string
}

const SubmittedContent = ({
  content,
}: SubmittedContentProps) => {
  return (
    <Markdown content={content} />
  )
}

export default React.memo(SubmittedContent)
