import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
  useEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useThrottleEffect } from 'ahooks'
import type {
  ChatConfig,
  ChatItem,
  OnSend,
} from '../types'
import Question from './question'
import Answer from './answer'
import ChatInput from './chat-input'
import TryToAsk from './try-to-ask'
import { ChatContextProvider } from './context'
import type { Emoji } from '@/app/components/tools/types'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'

export type ChatProps = {
  chatList: ChatItem[]
  config?: ChatConfig
  isResponsing?: boolean
  noStopResponding?: boolean
  onStopResponding?: () => void
  noChatInput?: boolean
  onSend?: OnSend
  chatContainerclassName?: string
  chatFooterClassName?: string
  suggestedQuestions?: string[]
  showPromptLog?: boolean
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  allToolIcons?: Record<string, string | Emoji>
  onAnnotationEdited?: (question: string, answer: string, index: number) => void
  onAnnotationAdded?: (annotationId: string, authorName: string, question: string, answer: string, index: number) => void
  onAnnotationRemoved?: (index: number) => void
}
const Chat: FC<ChatProps> = ({
  config,
  onSend,
  chatList,
  isResponsing,
  noStopResponding,
  onStopResponding,
  noChatInput,
  chatContainerclassName,
  chatFooterClassName,
  suggestedQuestions,
  showPromptLog,
  questionIcon,
  answerIcon,
  allToolIcons,
  onAnnotationAdded,
  onAnnotationEdited,
  onAnnotationRemoved,
}) => {
  const { t } = useTranslation()
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatFooterRef = useRef<HTMLDivElement>(null)

  const handleScrolltoBottom = () => {
    if (chatContainerRef.current)
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
  }

  useThrottleEffect(() => {
    handleScrolltoBottom()

    if (chatContainerRef.current && chatFooterRef.current)
      chatFooterRef.current.style.width = `${chatContainerRef.current.clientWidth}px`
  }, [chatList], { wait: 500 })

  useEffect(() => {
    if (chatFooterRef.current && chatContainerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { blockSize } = entry.borderBoxSize[0]

          chatContainerRef.current!.style.paddingBottom = `${blockSize}px`
          handleScrolltoBottom()
        }
      })

      resizeObserver.observe(chatFooterRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [chatFooterRef, chatContainerRef])

  const hasTryToAsk = config?.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend

  return (
    <ChatContextProvider
      config={config}
      chatList={chatList}
      isResponsing={isResponsing}
      showPromptLog={showPromptLog}
      questionIcon={questionIcon}
      answerIcon={answerIcon}
      allToolIcons={allToolIcons}
      onSend={onSend}
      onAnnotationAdded={onAnnotationAdded}
      onAnnotationEdited={onAnnotationEdited}
      onAnnotationRemoved={onAnnotationRemoved}
    >
      <div className='relative h-full'>
        <div
          ref={chatContainerRef}
          className={`relative h-full overflow-y-auto ${chatContainerclassName}`}
        >
          {
            chatList.map((item, index) => {
              if (item.isAnswer) {
                return (
                  <Answer
                    key={item.id}
                    item={item}
                    question={chatList[index - 1]?.content}
                    index={index}
                  />
                )
              }
              return (
                <Question
                  key={item.id}
                  item={item}
                />
              )
            })
          }
        </div>
        <div
          className={`absolute bottom-0 ${(hasTryToAsk || !noChatInput || !noStopResponding) && chatFooterClassName}`}
          ref={chatFooterRef}
          style={{
            background: 'linear-gradient(0deg, #F9FAFB 40%, rgba(255, 255, 255, 0.00) 100%)',
          }}
        >
          {
            !noStopResponding && isResponsing && (
              <div className='flex justify-center mb-2'>
                <Button className='py-0 px-3 h-7 bg-white shadow-xs' onClick={onStopResponding}>
                  <StopCircle className='mr-[5px] w-3.5 h-3.5 text-gray-500' />
                  <span className='text-xs text-gray-500 font-normal'>{t('appDebug.operation.stopResponding')}</span>
                </Button>
              </div>
            )
          }
          {
            hasTryToAsk && (
              <TryToAsk
                suggestedQuestions={suggestedQuestions}
                onSend={onSend}
              />
            )
          }
          {
            !noChatInput && (
              <ChatInput
                visionConfig={config?.file_upload?.image}
                speechToTextConfig={config?.speech_to_text}
                onSend={onSend}
              />
            )
          }
        </div>
      </div>
    </ChatContextProvider>
  )
}

export default memo(Chat)
