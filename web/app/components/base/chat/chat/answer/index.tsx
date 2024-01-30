import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import { useCurrentAnswerIsResponsing } from '../hooks'
import Operation from './operation'
import AgentContent from './agent-content'
import BasicContent from './basic-content'
import SuggestedQuestions from './suggested-questions'
import More from './more'
import { AnswerTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import LoadingAnim from '@/app/components/app/chat/loading-anim'
import Citation from '@/app/components/app/chat/citation'
import { EditTitle } from '@/app/components/app/annotation/edit-annotation-modal/edit-item'

type AnswerProps = {
  item: ChatItem
  question: string
  index: number
}
const Answer: FC<AnswerProps> = ({
  item,
  question,
  index,
}) => {
  const { t } = useTranslation()
  const {
    config,
    answerIcon,
  } = useChatContext()
  const responsing = useCurrentAnswerIsResponsing(item.id)
  const {
    content,
    citation,
    agent_thoughts,
    more,
    annotation,
  } = item
  const hasAgentThoughts = !!agent_thoughts?.length

  return (
    <div className='flex mb-2 last:mb-0'>
      <div className='shrink-0 relative w-10 h-10'>
        {
          answerIcon || (
            <div className='flex items-center justify-center w-full h-full rounded-full bg-[#d5f5f6] border-[0.5px] border-black/5 text-xl'>
              🤖
            </div>
          )
        }
        {
          responsing && (
            <div className='absolute -top-[3px] -left-[3px] pl-[6px] flex items-center w-4 h-4 bg-white rounded-full shadow-xs border-[0.5px] border-gray-50'>
              <LoadingAnim type='avatar' />
            </div>
          )
        }
      </div>
      <div className='chat-answer-container grow w-0 group ml-4'>
        <div className='relative pr-10'>
          <AnswerTriangle className='absolute -left-2 top-0 w-2 h-3 text-gray-100' />
          <div className='group relative inline-block px-4 py-3 max-w-full bg-gray-100 rounded-b-2xl rounded-tr-2xl text-sm text-gray-900'>
            {
              !responsing && (
                <Operation
                  item={item}
                  question={question}
                  index={index}
                />
              )
            }
            {
              responsing && !content && !hasAgentThoughts && (
                <div className='flex items-center justify-center w-6 h-5'>
                  <LoadingAnim type='text' />
                </div>
              )
            }
            {
              content && !hasAgentThoughts && (
                <BasicContent item={item} />
              )
            }
            {
              hasAgentThoughts && !content && (
                <AgentContent item={item} />
              )
            }
            {
              annotation?.id && annotation.authorName && (
                <EditTitle
                  className='mt-1'
                  title={t('appAnnotation.editBy', { author: annotation.authorName })}
                />
              )
            }
            <SuggestedQuestions item={item} />
            {
              !!citation?.length && config?.retriever_resource?.enabled && !responsing && (
                <Citation data={citation} showHitInfo />
              )
            }
          </div>
        </div>
        <More more={more} />
      </div>
    </div>
  )
}

export default Answer
