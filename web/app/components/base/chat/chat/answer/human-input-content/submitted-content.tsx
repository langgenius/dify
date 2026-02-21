import * as React from 'react'
import { Markdown } from '@/app/components/base/markdown'

type SubmittedContentProps = {
  content: string
}

const SubmittedContent = ({
  content,
}: SubmittedContentProps) => {
  return (
    <div data-testid="submitted-content">
      <Markdown content={content} />
    </div>
  )
}

export default React.memo(SubmittedContent)
