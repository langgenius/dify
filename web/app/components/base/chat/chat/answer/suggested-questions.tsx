import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useChatContext } from '../context'

type SuggestedQuestionsProps = {
  item: ChatItem
}
const SuggestedQuestions: FC<SuggestedQuestionsProps> = ({ item }) => {
  const { onSend, readonly } = useChatContext()

  const { isOpeningStatement, suggestedQuestions } = item

  if (!isOpeningStatement || !suggestedQuestions?.length) return null

  return (
    <div className="flex flex-wrap">
      {suggestedQuestions
        .filter((q) => !!q && q.trim())
        .map((question, index) => (
          <button
            type="button"
            key={index}
            className={cn(
              'mt-1 mr-1 inline-flex max-w-full shrink-0 cursor-pointer appearance-none flex-wrap rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 py-2 text-start system-sm-medium text-components-button-secondary-accent-text shadow-xs last:mr-0 hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              readonly && 'pointer-events-none opacity-50',
            )}
            disabled={readonly}
            onClick={() => onSend?.(question)}
          >
            {question}
          </button>
        ))}
    </div>
  )
}

export default memo(SuggestedQuestions)
