import type {
  FC,
  ReactNode,
} from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, usePathname } from 'next/navigation'
import type {
  ChatConfig,
  ChatItem,
} from '../../types'
import { useChatContext } from '../context'
import Operation from './operation'
import AgentContent from './agent-content'
import BasicContent from './basic-content'
import SuggestedQuestions from './suggested-questions'
import More from './more'
import WorkflowProcess from './workflow-process'
import type AudioPlayer from './audio'
import { getAudioPlayer } from './audio'
import { AnswerTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import Citation from '@/app/components/base/chat/chat/citation'
import { EditTitle } from '@/app/components/app/annotation/edit-annotation-modal/edit-item'
import type { Emoji } from '@/app/components/tools/types'
import { textToAudioStream } from '@/service/share'
import type { AppData } from '@/models/share'

type AnswerProps = {
  item: ChatItem
  question: string
  index: number
  config?: ChatConfig
  answerIcon?: ReactNode
  responding?: boolean
  allToolIcons?: Record<string, string | Emoji>
  showPromptLog?: boolean
  chatAnswerContainerInner?: string
  hideProcessDetail?: boolean
  appData?: AppData
}
const Answer: FC<AnswerProps> = ({
  item,
  question,
  index,
  config,
  answerIcon,
  responding,
  allToolIcons,
  showPromptLog,
  chatAnswerContainerInner,
  hideProcessDetail,
  appData,
}) => {
  const { t } = useTranslation()
  const {
    content,
    citation,
    agent_thoughts,
    more,
    annotation,
    workflowProcess,
  } = item
  const hasAgentThoughts = !!agent_thoughts?.length

  const [containerWidth, setContainerWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [localFeedback, setLocalFeedback] = useState(item.feedback)
  const params = useParams()
  const pathname = usePathname()
  const messageIDFromDB = useMemo(() => (item.content || item.agent_thoughts?.length) ? item.id : '', [item])
  const audioPlayerRef = useRef<AudioPlayer | null>(null)

  const {
    config: chatContextConfig,
    onFeedback,
  } = useChatContext()

  const autoPlayAudio = useMemo(() => chatContextConfig?.text_to_speech?.autoPlay === 'enabled', [chatContextConfig?.text_to_speech?.autoPlay])
  const voiceRef = useRef(chatContextConfig?.text_to_speech?.voice)

  const handleFeedback = async (rating: 'like' | 'dislike' | null) => {
    if (!chatContextConfig?.supportFeedback || !onFeedback)
      return
    await onFeedback?.(item.id, { rating })
    setLocalFeedback({ rating })
  }
  const getContainerWidth = () => {
    if (containerRef.current)
      setContainerWidth(containerRef.current?.clientWidth + 16)
  }
  const getContentWidth = () => {
    if (contentRef.current)
      setContentWidth(contentRef.current?.clientWidth)
  }

  const autoPlayAudioForMessage = async (messageId: string) => {
    let url = ''
    let isPublic = false

    if (params.token) {
      url = '/text-to-audio/message-id'
      isPublic = true
    }
    else if (params.appId) {
      if (pathname.search('explore/installed') > -1)
        url = `/installed-apps/${params.appId}/text-to-audio/message-id`
      else
        url = `/apps/${params.appId}/text-to-audio/message-id`
    }

    try {
      const audioResponse: any = await textToAudioStream(url, isPublic, {
        message_id: messageId,
        streaming: true,
        voice: voiceRef.current,
      })

      const reader = audioResponse.body.getReader() // 获取reader

      const audioPlayer = getAudioPlayer()

      audioPlayerRef.current = audioPlayer

      while (true) {
        const { value, done } = await reader.read()

        if (done)
          break
        audioPlayer.receiveAudioData(value)
      }
    }

    catch (error) {
      console.error('Error playing audio:', error)
    }
  }

  useEffect(() => {
    getContainerWidth()
    let audioPlayer: AudioPlayer | null = null
    if (chatContextConfig?.text_to_speech?.enabled) {
      audioPlayer = getAudioPlayer()
      audioPlayer.stop()
    }

    return () => {
      audioPlayerRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    voiceRef.current = chatContextConfig?.text_to_speech?.voice
  }
  , [chatContextConfig?.text_to_speech?.voice])

  useEffect(() => {
    if (!responding)
      getContentWidth()
  }, [responding])

  useEffect(() => {
    if (messageIDFromDB && autoPlayAudio && responding)
      autoPlayAudioForMessage(messageIDFromDB)
  }, [messageIDFromDB, autoPlayAudio, responding])

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
          responding && (
            <div className='absolute -top-[3px] -left-[3px] pl-[6px] flex items-center w-4 h-4 bg-white rounded-full shadow-xs border-[0.5px] border-gray-50'>
              <LoadingAnim type='avatar' />
            </div>
          )
        }
      </div>
      <div className='chat-answer-container group grow w-0 ml-4' ref={containerRef}>
        <div className={`group relative pr-10 ${chatAnswerContainerInner}`}>
          <AnswerTriangle className='absolute -left-2 top-0 w-2 h-3 text-gray-100' />
          <div
            ref={contentRef}
            className={`
              relative inline-block px-4 py-3 max-w-full bg-gray-100 rounded-b-2xl rounded-tr-2xl text-sm text-gray-900
              ${workflowProcess && 'w-full'}
            `}
          >
            {annotation?.id && (
              <div
                className='absolute -top-3.5 -right-3.5 box-border flex items-center justify-center h-7 w-7 p-0.5 rounded-lg bg-white cursor-pointer text-[#444CE7] shadow-md group-hover:hidden'
              >
                <div className='p-1 rounded-lg bg-[#EEF4FF] '>
                  <MessageFast className='w-4 h-4' />
                </div>
              </div>
            )}
            {
              !responding && (
                <Operation
                  hasWorkflowProcess={!!workflowProcess}
                  maxSize={containerWidth - contentWidth - 4}
                  contentWidth={contentWidth}
                  item={item}
                  question={question}
                  index={index}
                  showPromptLog={showPromptLog}
                />
              )
            }
            {/** Render the normal steps */}
            {
              workflowProcess && !hideProcessDetail && (
                <WorkflowProcess
                  data={workflowProcess}
                  item={item}
                  hideInfo
                  hideProcessDetail={hideProcessDetail}
                />
              )
            }
            {/** Hide workflow steps by it's settings in siteInfo */}
            {
              workflowProcess && hideProcessDetail && appData && appData.site.show_workflow_steps && (
                <WorkflowProcess
                  data={workflowProcess}
                  item={item}
                  hideInfo
                  hideProcessDetail={hideProcessDetail}
                />
              )
            }
            {
              responding && !content && !hasAgentThoughts && (
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
              hasAgentThoughts && (
                <AgentContent
                  item={item}
                  responding={responding}
                  allToolIcons={allToolIcons}
                />
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
              !!citation?.length && !responding && (
                <Citation data={citation} showHitInfo={config?.supportCitationHitInfo} />
              )
            }
          </div>
        </div>
        <More more={more} />
      </div>
    </div>
  )
}

export default memo(Answer)
