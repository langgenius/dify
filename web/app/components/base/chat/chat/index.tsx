import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import { useShallow } from 'zustand/react/shallow'
import type {
  ChatConfig,
  ChatItem,
  Feedback,
  OnRegenerate,
  OnSend,
} from '../types'
import type { ThemeBuilder } from '../embedded-chatbot/theme/theme-context'
import Question from './question'
import Answer from './answer'
import ChatInputArea from './chat-input-area'
import TryToAsk from './try-to-ask'
import { ChatContextProvider } from './context'
import type { InputForm } from './type'
import cn from '@/utils/classnames'
import type { Emoji } from '@/app/components/tools/types'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { AppData } from '@/models/share'

export type ChatProps = {
  appData?: AppData
  chatList: ChatItem[]
  config?: ChatConfig
  isResponding?: boolean
  noStopResponding?: boolean
  onStopResponding?: () => void
  noChatInput?: boolean
  onSend?: OnSend
  inputs?: Record<string, any>
  inputsForm?: InputForm[]
  onRegenerate?: OnRegenerate
  chatContainerClassName?: string
  chatContainerInnerClassName?: string
  chatFooterClassName?: string
  chatFooterInnerClassName?: string
  suggestedQuestions?: string[]
  showPromptLog?: boolean
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  allToolIcons?: Record<string, string | Emoji>
  onAnnotationEdited?: (question: string, answer: string, index: number) => void
  onAnnotationAdded?: (annotationId: string, authorName: string, question: string, answer: string, index: number) => void
  onAnnotationRemoved?: (index: number) => void
  chatNode?: ReactNode
  onFeedback?: (messageId: string, feedback: Feedback) => void
  chatAnswerContainerInner?: string
  hideProcessDetail?: boolean
  hideLogModal?: boolean
  themeBuilder?: ThemeBuilder
  switchSibling?: (siblingMessageId: string) => void
  showFeatureBar?: boolean
  showFileUpload?: boolean
  onFeatureBarClick?: (state: boolean) => void
  noSpacing?: boolean
  inputDisabled?: boolean
  isMobile?: boolean
  sidebarCollapseState?: boolean
}

const Chat: FC<ChatProps> = ({
  appData,
  config,
  onSend,
  inputs,
  inputsForm,
  onRegenerate,
  chatList,
  isResponding,
  noStopResponding,
  onStopResponding,
  noChatInput,
  chatContainerClassName,
  chatContainerInnerClassName,
  chatFooterClassName,
  chatFooterInnerClassName,
  suggestedQuestions,
  showPromptLog,
  questionIcon,
  answerIcon,
  onAnnotationAdded,
  onAnnotationEdited,
  onAnnotationRemoved,
  chatNode,
  onFeedback,
  chatAnswerContainerInner,
  hideProcessDetail,
  hideLogModal,
  themeBuilder,
  switchSibling,
  showFeatureBar,
  showFileUpload,
  onFeatureBarClick,
  noSpacing,
  inputDisabled,
  isMobile,
  sidebarCollapseState,
}) => {
  const { t } = useTranslation()
  const { currentLogItem, setCurrentLogItem, showPromptLogModal, setShowPromptLogModal, showAgentLogModal, setShowAgentLogModal } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
    showAgentLogModal: state.showAgentLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
  })))
  const [width, setWidth] = useState(0)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatContainerInnerRef = useRef<HTMLDivElement>(null)
  const chatFooterRef = useRef<HTMLDivElement>(null)
  const chatFooterInnerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  const handleScrollToBottom = useCallback(() => {
    if (chatList.length > 1 && chatContainerRef.current && !userScrolledRef.current)
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
  }, [chatList.length])

  const handleWindowResize = useCallback(() => {
    if (chatContainerRef.current)
      setWidth(document.body.clientWidth - (chatContainerRef.current?.clientWidth + 16) - 8)

    if (chatContainerRef.current && chatFooterRef.current)
      chatFooterRef.current.style.width = `${chatContainerRef.current.clientWidth}px`

    if (chatContainerInnerRef.current && chatFooterInnerRef.current)
      chatFooterInnerRef.current.style.width = `${chatContainerInnerRef.current.clientWidth}px`
  }, [])

  useEffect(() => {
    handleScrollToBottom()
    handleWindowResize()
  }, [handleScrollToBottom, handleWindowResize])

  useEffect(() => {
    if (chatContainerRef.current) {
      requestAnimationFrame(() => {
        handleScrollToBottom()
        handleWindowResize()
      })
    }
  })

  useEffect(() => {
    const debouncedHandler = debounce(handleWindowResize, 200)
    window.addEventListener('resize', debouncedHandler)

    return () => {
      window.removeEventListener('resize', debouncedHandler)
      debouncedHandler.cancel()
    }
  }, [handleWindowResize])

  useEffect(() => {
    if (chatFooterRef.current && chatContainerRef.current) {
      // container padding bottom
      const resizeContainerObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { blockSize } = entry.borderBoxSize[0]
          chatContainerRef.current!.style.paddingBottom = `${blockSize}px`
          handleScrollToBottom()
        }
      })
      resizeContainerObserver.observe(chatFooterRef.current)

      // footer width
      const resizeFooterObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          chatFooterRef.current!.style.width = `${inlineSize}px`
        }
      })
      resizeFooterObserver.observe(chatContainerRef.current)

      return () => {
        resizeContainerObserver.disconnect()
        resizeFooterObserver.disconnect()
      }
    }
  }, [handleScrollToBottom])

  useEffect(() => {
    const chatContainer = chatContainerRef.current
    if (chatContainer) {
      const setUserScrolled = () => {
        // eslint-disable-next-line sonarjs/no-gratuitous-expressions
        if (chatContainer) // its in event callback, chatContainer may be null
          userScrolledRef.current = chatContainer.scrollHeight - chatContainer.scrollTop > chatContainer.clientHeight
      }
      chatContainer.addEventListener('scroll', setUserScrolled)
      return () => chatContainer.removeEventListener('scroll', setUserScrolled)
    }
  }, [])

  useEffect(() => {
    if (!sidebarCollapseState)
      setTimeout(() => handleWindowResize(), 200)
  }, [handleWindowResize, sidebarCollapseState])

  const hasTryToAsk = config?.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend

  return (
    <ChatContextProvider
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      showPromptLog={showPromptLog}
      questionIcon={questionIcon}
      answerIcon={answerIcon}
      onSend={onSend}
      onRegenerate={onRegenerate}
      onAnnotationAdded={onAnnotationAdded}
      onAnnotationEdited={onAnnotationEdited}
      onAnnotationRemoved={onAnnotationRemoved}
      onFeedback={onFeedback}
    >
      <div className='relative h-full'>
        <div
          ref={chatContainerRef}
          className={cn('relative h-full overflow-y-auto overflow-x-hidden', chatContainerClassName)}
        >
          {chatNode}
          <div
            ref={chatContainerInnerRef}
            className={cn('w-full', !noSpacing && 'px-8', chatContainerInnerClassName)}
          >
            {
              chatList.map((item, index) => {
                if (item.isAnswer) {
                  const isLast = item.id === chatList[chatList.length - 1]?.id
                  return (
                    <Answer
                      appData={appData}
                      key={item.id}
                      item={item}
                      question={chatList[index - 1]?.content}
                      index={index}
                      config={config}
                      answerIcon={answerIcon}
                      responding={isLast && isResponding}
                      showPromptLog={showPromptLog}
                      chatAnswerContainerInner={chatAnswerContainerInner}
                      hideProcessDetail={hideProcessDetail}
                      noChatInput={noChatInput}
                      switchSibling={switchSibling}
                    />
                  )
                }
                return (
                  <Question
                    key={item.id}
                    item={item}
                    questionIcon={questionIcon}
                    theme={themeBuilder?.theme}
                    enableEdit={config?.questionEditEnable}
                    switchSibling={switchSibling}
                  />
                )
              })
            }
          </div>
        </div>
        <div
          className={`absolute bottom-0 z-10 flex justify-center bg-chat-input-mask ${(hasTryToAsk || !noChatInput || !noStopResponding) && chatFooterClassName}`}
          ref={chatFooterRef}
        >
          <div
            ref={chatFooterInnerRef}
            className={cn('relative', chatFooterInnerClassName)}
          >
            {
              !noStopResponding && isResponding && (
                <div className='mb-2 flex justify-center'>
                  <Button className='border-components-panel-border bg-components-panel-bg text-components-button-secondary-text' onClick={onStopResponding}>
                    <StopCircle className='mr-[5px] h-3.5 w-3.5' />
                    <span className='text-xs font-normal'>{t('appDebug.operation.stopResponding')}</span>
                  </Button>
                </div>
              )
            }
            {
              hasTryToAsk && (
                <TryToAsk
                  suggestedQuestions={suggestedQuestions}
                  onSend={onSend}
                  isMobile={isMobile}
                />
              )
            }
            {
              !noChatInput && (
                <ChatInputArea
                  botName={appData?.site.title || 'Bot'}
                  disabled={inputDisabled}
                  showFeatureBar={showFeatureBar}
                  showFileUpload={showFileUpload}
                  featureBarDisabled={isResponding}
                  onFeatureBarClick={onFeatureBarClick}
                  visionConfig={config?.file_upload}
                  speechToTextConfig={config?.speech_to_text}
                  onSend={onSend}
                  inputs={inputs}
                  inputsForm={inputsForm}
                  theme={themeBuilder?.theme}
                  isResponding={isResponding}
                />
              )
            }
          </div>
        </div>
        {showPromptLogModal && !hideLogModal && (
          <PromptLogModal
            width={width}
            currentLogItem={currentLogItem}
            onCancel={() => {
              setCurrentLogItem()
              setShowPromptLogModal(false)
            }}
          />
        )}
        {showAgentLogModal && !hideLogModal && (
          <AgentLogModal
            width={width}
            currentLogItem={currentLogItem}
            onCancel={() => {
              setCurrentLogItem()
              setShowAgentLogModal(false)
            }}
          />
        )}
      </div>
    </ChatContextProvider>
  )
}

export default memo(Chat)
