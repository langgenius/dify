import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import * as React from 'react'
import { format } from '@/service/base'
import Header from './header'

export type IResultProps = {
  content: string
  showFeedback: boolean
  feedback: FeedbackType
  onFeedback: (feedback: FeedbackType) => void
}
const Result: FC<IResultProps> = ({
  content,
  showFeedback,
  feedback,
  onFeedback,
}) => {
  return (
    <div className="h-max basis-3/4">
      <Header result={content} showFeedback={showFeedback} feedback={feedback} onFeedback={onFeedback} />
      <div
        className="mt-4 flex w-full overflow-scroll text-sm font-normal leading-5 text-gray-900"
        style={{
          maxHeight: '70vh',
        }}
        dangerouslySetInnerHTML={{
          __html: format(content),
        }}
      >
      </div>
    </div>
  )
}
export default React.memo(Result)
