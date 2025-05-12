import type { FC } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'

type SuggestedQuestionsProps = {
  item: ChatItem
}
const SuggestedQuestions: FC<SuggestedQuestionsProps> = ({
  item,
}) => {
  const { onSend } = useChatContext()

  const {
    isOpeningStatement,
    suggestedQuestions,
  } = item

  if (!isOpeningStatement || !suggestedQuestions?.length)
    return null

  return (
    <div className='flex flex-wrap'>
      {suggestedQuestions.filter(q => !!q && q.trim()).map((question, index) => (
        <div
          key={index}
          className='system-sm-medium mr-1 mt-1 inline-flex max-w-full shrink-0 cursor-pointer flex-wrap rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 py-2 text-components-button-secondary-accent-text shadow-xs last:mr-0 hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover'
          onClick={() => onSend?.(question)}
        >
          {question}
        </div>),
      )}
    </div>
  )
}

export default memo(SuggestedQuestions)
