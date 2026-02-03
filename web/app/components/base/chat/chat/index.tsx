import type {
  FC,
  ReactNode,
} from 'react'
import type { ThemeBuilder } from '../embedded-chatbot/theme/theme-context'
import type {
  ChatConfig,
  ChatItem,
  Feedback,
  OnRegenerate,
  OnSend,
} from '../types'
import type { InputForm } from './type'
import type { Emoji } from '@/app/components/tools/types'
import type { AppData } from '@/models/share'
import { debounce } from 'es-toolkit/compat'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { cn } from '@/utils/classnames'
import Answer from './answer'
import ChatInputArea from './chat-input-area'
import { ChatContextProvider } from './context'
import Question from './question'
import TryToAsk from './try-to-ask'

export type ChatProps = {
  isTryApp?: boolean
  readonly?: boolean
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
  disableFeedback?: boolean
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
  sidebarCollapseState?: boolean
}

const Chat: FC<ChatProps> = ({
  isTryApp,
  readonly = false,
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
  disableFeedback,
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
  const isAutoScrollingRef = useRef(false)

  const handleScrollToBottom = useCallback(() => {
    if (chatList.length > 1 && chatContainerRef.current && !userScrolledRef.current) {
      isAutoScrollingRef.current = true
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight

      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false
      })
    }
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
    const setUserScrolled = () => {
      const container = chatContainerRef.current
      if (!container)
        return

      if (isAutoScrollingRef.current)
        return

      const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop
      const SCROLL_UP_THRESHOLD = 100

      userScrolledRef.current = distanceToBottom > SCROLL_UP_THRESHOLD
    }

    const container = chatContainerRef.current
    if (!container)
      return

    container.addEventListener('scroll', setUserScrolled)
    return () => container.removeEventListener('scroll', setUserScrolled)
  }, [])

  // Reset user scroll state when conversation changes or a new chat starts
  // Track the first message ID to detect conversation switches (fixes #29820)
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const firstMessageId = chatList[0]?.id
    // Reset when: new chat (length <= 1) OR conversation switched (first message ID changed)
    if (chatList.length <= 1 || (firstMessageId && prevFirstMessageIdRef.current !== firstMessageId))
      userScrolledRef.current = false
    prevFirstMessageIdRef.current = firstMessageId
  }, [chatList])

  useEffect(() => {
    if (!sidebarCollapseState)
      setTimeout(() => handleWindowResize(), 200)
  }, [handleWindowResize, sidebarCollapseState])

  const hasTryToAsk = config?.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend

  return (
    <ChatContextProvider
      readonly={readonly}
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
      disableFeedback={disableFeedback}
      onFeedback={onFeedback}
    >
      <div className={cn('relative h-full', isTryApp && 'flex flex-col')}>
        <div
          ref={chatContainerRef}
          className={cn('relative h-full overflow-y-auto overflow-x-hidden', isTryApp && 'h-0 grow', chatContainerClassName)}
        >
          {chatNode}
          <div
            ref={chatContainerInnerRef}
            className={cn('w-full', !noSpacing && 'px-8', chatContainerInnerClassName, isTryApp && 'px-0')}
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
            className={cn('relative', chatFooterInnerClassName, isTryApp && 'px-0')}
          >
            {
              !noStopResponding && isResponding && (
                <div className="mb-2 flex justify-center">
                  <Button className="border-components-panel-border bg-components-panel-bg text-components-button-secondary-text" onClick={onStopResponding}>
                    <StopCircle className="mr-[5px] h-3.5 w-3.5" />
                    <span className="text-xs font-normal">{t('operation.stopResponding', { ns: 'appDebug' })}</span>
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
                <ChatInputArea
                  botName={appData?.site?.title || 'Bot'}
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
                  readonly={readonly}
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
