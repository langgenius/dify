import type { FC } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import Button from '@/app/components/base/button'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type SuggestedQuestionsProps = {
  item: ChatItem
}
const SuggestedQuestions: FC<SuggestedQuestionsProps> = ({
  item,
}) => {
  const { onSend } = useChatContext()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const klassName = `mr-1 mt-1 ${isMobile ? 'block overflow-hidden text-ellipsis' : ''} max-w-full shrink-0 last:mr-0`

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
          className={klassName}
          onClick={() => onSend?.(question)}
        >
          {question}
        </Button>),
      )}
    </div>
  )
}

export default memo(SuggestedQuestions)
