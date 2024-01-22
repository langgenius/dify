import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ChatItem,
  VisionFile,
} from '../types'
import { useChatContext } from '../context'
import { AnswerTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import LoadingAnim from '@/app/components/app/chat/loading-anim'
import { MessageHeartCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import { Markdown } from '@/app/components/base/markdown'
import { formatNumber } from '@/utils/format'
import Citation from '@/app/components/app/chat/citation'
import CopyBtn from '@/app/components/app/chat/copy-btn'
import Thought from '@/app/components/app/chat/thought'
import ImageGallery from '@/app/components/base/image-gallery'

type AnswerProps = {
  item: ChatItem
  icon?: ReactNode
  responsing?: boolean
}
const Answer: FC<AnswerProps> = ({
  item,
  icon,
  responsing,
}) => {
  const { t } = useTranslation()
  const {
    config,
    allToolIcons,
  } = useChatContext()
  const {
    isOpeningStatement,
    content,
    citation,
    agent_thoughts,
    more,
  } = item
  const isAgentMode = agent_thoughts?.length

  const getImgs = (list?: VisionFile[]) => {
    if (!list)
      return []
    return list.filter(file => file.type === 'image' && file.belongs_to === 'assistant')
  }

  const agentModeAnswer = (
    <div>
      {agent_thoughts?.map((item, index) => (
        <div key={index}>
          {item.thought && (
            <Markdown content={item.thought} />
          )}
          {/* {item.tool} */}
          {/* perhaps not use tool */}
          {!!item.tool && (
            <Thought
              thought={item}
              allToolIcons={allToolIcons || {}}
              isFinished={!!item.observation}
            />
          )}

          {getImgs(item.message_files).length > 0 && (
            <ImageGallery srcs={getImgs(item.message_files).map(item => item.url)} />
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className='flex mb-2 last:mb-0'>
      <div className='shrink-0 relative w-10 h-10'>
        {
          icon || (
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
            <div className='hidden absolute top-[-14px] right-[-14px] group-hover:flex flex-row justify-end gap-1'>
              {
                !item.isOpeningStatement && !responsing && (
                  <CopyBtn
                    value={content}
                    className='mr-1'
                  />
                )
              }
            </div>
            {
              isOpeningStatement && (
                <div className='flex items-center mb-1 h-[18px]'>
                  <MessageHeartCircle className='mr-1 w-3 h-3 text-gray-500' />
                  <div className='text-xs text-gray-500'>{t('appDebug.openingStatement.title')}</div>
                </div>
              )
            }
            {
              responsing && !content && !agent_thoughts?.length && (
                <div className='flex items-center justify-center w-6 h-5'>
                  <LoadingAnim type='text' />
                </div>
              )
            }
            {
              content && !isAgentMode && (
                <div>
                  <Markdown content={content} />
                </div>
              )
            }
            {
              isAgentMode && (
                agentModeAnswer
              )
            }
            {
              !!citation?.length && config.retriever_resource?.enabled && !responsing && (
                <Citation data={citation} showHitInfo />
              )
            }
          </div>
        </div>
        <div className='flex items-center mt-1 h-[18px] text-xs text-gray-400 opacity-0 group-hover:opacity-100'>
          {
            more && (
              <>
                <div
                  className='mr-2 shrink-0 truncate max-w-[33.3%]'
                  title={`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}
                >
                  {`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}
                </div>
                <div
                  className='shrink-0 truncate max-w-[33.3%]'
                  title={`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}
                >
                  {`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}
                </div>
                <div className='shrink-0 mx-2'>·</div>
                <div
                  className='shrink-0 truncate max-w-[33.3%]'
                  title={more.time}
                >
                  {more.time}
                </div>
              </>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default Answer
