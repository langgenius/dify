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
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { Button } from '@/app/components/base/ui/button'
import Answer from './answer'
import ChatInputArea from './chat-input-area'
import ChatLogModals from './chat-log-modals'
import { ChatContextProvider } from './context-provider'
import Question from './question'
import TryToAsk from './try-to-ask'
import { useChatLayout } from './use-chat-layout'

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
  hideAvatar?: boolean
  sendOnEnter?: boolean
  onHumanInputFormSubmit?: (formToken: string, formData: any) => Promise<void>
  getHumanInputNodeData?: (nodeID: string) => any
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
  hideAvatar,
  sendOnEnter,
  onHumanInputFormSubmit,
  getHumanInputNodeData,
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
  const {
    width,
    chatContainerRef,
    chatContainerInnerRef,
    chatFooterRef,
    chatFooterInnerRef,
  } = useChatLayout({
    chatList,
    sidebarCollapseState,
  })

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
      getHumanInputNodeData={getHumanInputNodeData}
    >
      <div data-testid="chat-root" className={cn('relative h-full', isTryApp && 'flex flex-col')}>
        <div
          data-testid="chat-container"
          ref={chatContainerRef}
          className={cn('relative h-full overflow-x-hidden overflow-y-auto', isTryApp && 'h-0 grow', chatContainerClassName)}
        >
          {chatNode}
          <div
            ref={chatContainerInnerRef}
            className={cn('w-full', !noSpacing && 'px-8', chatContainerInnerClassName, isTryApp && 'px-0')}
          >
            {
              chatList.map((item, index) => {
                if (item.isAnswer) {
                  const isLast = item.id === chatList.at(-1)?.id
                  return (
                    <Answer
                      appData={appData}
                      key={item.id}
                      item={item}
                      question={chatList[index - 1]?.content!}
                      index={index}
                      config={config}
                      answerIcon={answerIcon}
                      responding={isLast && isResponding}
                      showPromptLog={showPromptLog}
                      chatAnswerContainerInner={chatAnswerContainerInner}
                      hideProcessDetail={hideProcessDetail}
                      noChatInput={noChatInput}
                      switchSibling={switchSibling}
                      hideAvatar={hideAvatar}
                      onHumanInputFormSubmit={onHumanInputFormSubmit}
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
                    hideAvatar={hideAvatar}
                  />
                )
              })
            }
          </div>
        </div>
        <div
          data-testid="chat-footer"
          className={`absolute bottom-0 z-10 flex justify-center bg-chat-input-mask ${(hasTryToAsk || !noChatInput || !noStopResponding) && chatFooterClassName}`}
          ref={chatFooterRef}
        >
          <div
            ref={chatFooterInnerRef}
            className={cn('relative', chatFooterInnerClassName, isTryApp && 'px-0')}
          >
            {
              !noStopResponding && isResponding && (
                <div data-testid="stop-responding-container" className="mb-2 flex justify-center">
                  <Button className="border-components-panel-border bg-components-panel-bg text-components-button-secondary-text" onClick={onStopResponding}>
                    <div className="mr-[5px] i-custom-vender-solid-mediaAndDevices-stop-circle h-3.5 w-3.5" />
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
                  sendOnEnter={sendOnEnter}
                />
              )
            }
          </div>
        </div>
        <ChatLogModals
          width={width}
          currentLogItem={currentLogItem}
          showPromptLogModal={showPromptLogModal}
          showAgentLogModal={showAgentLogModal}
          hideLogModal={hideLogModal}
          setCurrentLogItem={setCurrentLogItem}
          setShowPromptLogModal={setShowPromptLogModal}
          setShowAgentLogModal={setShowAgentLogModal}
        />
      </div>
    </ChatContextProvider>
  )
}

export default memo(Chat)
