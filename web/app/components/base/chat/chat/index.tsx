import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
  useRef,
} from 'react'
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

export type ChatProps = {
  config: ChatConfig
  onSend?: OnSend
  chatList: ChatItem[]
  isResponsing: boolean
  noChatInput?: boolean
  chatContainerclassName?: string
  chatFooterClassName?: string
  suggestedQuestions?: string[]
  showPromptLog?: boolean
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  allToolIcons?: Record<string, string | Emoji>
}
const Chat: FC<ChatProps> = ({
  config,
  onSend,
  chatList,
  isResponsing,
  noChatInput,
  chatContainerclassName,
  chatFooterClassName,
  suggestedQuestions,
  showPromptLog,
  questionIcon,
  answerIcon,
  allToolIcons,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const chatFooterRef = useRef<HTMLDivElement>(null)

  useThrottleEffect(() => {
    if (ref.current)
      ref.current.scrollTop = ref.current.scrollHeight
  }, [chatList], { wait: 500 })

  const hasTryToAsk = config.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend

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
    >
      <div className='relative h-full'>
        <div
          ref={ref}
          className={`relative h-full overflow-y-auto ${chatContainerclassName}`}
        >
          {
            chatList.map((item) => {
              if (item.isAnswer) {
                return (
                  <Answer
                    key={item.id}
                    item={item}
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
          {
            (hasTryToAsk || !noChatInput) && (
              <div
                className={`sticky bottom-0 w-full backdrop-blur-[20px] ${chatFooterClassName}`}
                ref={chatFooterRef}
                style={{
                  background: 'linear-gradient(0deg, #FFF 0%, rgba(255, 255, 255, 0.40) 100%)',
                }}
              >
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
                      speechToTextConfig={config.speech_to_text}
                      onSend={onSend}
                    />
                  )
                }
              </div>
            )
          }
        </div>
      </div>
    </ChatContextProvider>
  )
}

export default memo(Chat)
