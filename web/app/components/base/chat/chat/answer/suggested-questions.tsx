import type { FC } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import Button from '@/app/components/base/button'

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
        <Button
          key={index}
          variant='secondary-accent'
          className='mt-1 mr-1 max-w-full last:mr-0 shrink-0'
          onClick={() => onSend?.(question)}
        >
          {question}
        </Button>),
      )}
    </div>
  )
}

export default memo(SuggestedQuestions)
