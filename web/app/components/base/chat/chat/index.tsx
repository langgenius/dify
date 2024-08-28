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
  OnSend,
} from '../types'
import type { ThemeBuilder } from '../embedded-chatbot/theme/theme-context'
import Question from './question'
import Answer from './answer'
import ChatInput from './chat-input'
import TryToAsk from './try-to-ask'
import { ChatContextProvider } from './context'
import classNames from '@/utils/classnames'
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
}

const Chat: FC<ChatProps> = ({
  appData,
  config,
  onSend,
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
  allToolIcons,
  onAnnotationAdded,
  onAnnotationEdited,
  onAnnotationRemoved,
  chatNode,
  onFeedback,
  chatAnswerContainerInner,
  hideProcessDetail,
  hideLogModal,
  themeBuilder,
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

  const handleScrolltoBottom = useCallback(() => {
    if (chatContainerRef.current && !userScrolledRef.current)
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
  }, [])

  const handleWindowResize = useCallback(() => {
    if (chatContainerRef.current)
      setWidth(document.body.clientWidth - (chatContainerRef.current?.clientWidth + 16) - 8)

    if (chatContainerRef.current && chatFooterRef.current)
      chatFooterRef.current.style.width = `${chatContainerRef.current.clientWidth}px`

    if (chatContainerInnerRef.current && chatFooterInnerRef.current)
      chatFooterInnerRef.current.style.width = `${chatContainerInnerRef.current.clientWidth}px`
  }, [])

  useEffect(() => {
    handleScrolltoBottom()
    handleWindowResize()
  }, [handleScrolltoBottom, handleWindowResize])

  useEffect(() => {
    if (chatContainerRef.current) {
      requestAnimationFrame(() => {
        handleScrolltoBottom()
        handleWindowResize()
      })
    }
  })

  useEffect(() => {
    window.addEventListener('resize', debounce(handleWindowResize))
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [handleWindowResize])

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
  }, [handleScrolltoBottom])

  useEffect(() => {
    const chatContainer = chatContainerRef.current
    if (chatContainer) {
      const setUserScrolled = () => {
        if (chatContainer)
          userScrolledRef.current = chatContainer.scrollHeight - chatContainer.scrollTop >= chatContainer.clientHeight + 300
      }
      chatContainer.addEventListener('scroll', setUserScrolled)
      return () => chatContainer.removeEventListener('scroll', setUserScrolled)
    }
  }, [])

  const hasTryToAsk = config?.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend

  return (
    <ChatContextProvider
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      showPromptLog={showPromptLog}
      questionIcon={questionIcon}
      answerIcon={answerIcon}
      allToolIcons={allToolIcons}
      onSend={onSend}
      onAnnotationAdded={onAnnotationAdded}
      onAnnotationEdited={onAnnotationEdited}
      onAnnotationRemoved={onAnnotationRemoved}
      onFeedback={onFeedback}
    >
      <div className='relative h-full'>
        <div
          ref={chatContainerRef}
          className={classNames('relative h-full overflow-y-auto', chatContainerClassName)}
        >
          <iframe
            src={`https://www.tradingview-widget.com/embed-widget/ticker-tape/?locale=en#{
              JSON.stringify({
                symbols: [
                  { proName: "FOREXCOM:SPXUSD", title: "S&P 500 Index" },
                  { proName: "FOREXCOM:NSXUSD", title: "US 100 Cash CFD" },
                  { proName: "FX_IDC:EURUSD", title: "EUR to USD" },
                  { proName: "BITSTAMP:BTCUSD", title: "Bitcoin" },
                  { description: "Apple Inc", proName: "NASDAQ:AAPL" },
                  { description: "Alphabet Inc", proName: "NASDAQ:GOOGL" },
                ],
                showSymbolLogo: true,
                isTransparent: true,
                displayMode: "adaptive",
                colorTheme: "light",
                width: "100%",
                height: 76,
                utm_source: "groq-stockbot.vercel.app",
                utm_medium: "widget_new",
                utm_campaign: "ticker-tape",
                "page-uri": "groq-stockbot.vercel.app/"
              })
            }`}
            title="ticker tape TradingView widget"
            lang="en"
            style={{
              userSelect: "none",
              boxSizing: "border-box",
              display: "block",
              height: "44px",
              width: "100%",
            }}
          ></iframe>
          {chatNode}
          <iframe
            src={`https://www.tradingview-widget.com/embed-widget/symbol-overview/?locale=vi#${encodeURIComponent(
              JSON.stringify({
                symbols: [["VCB"]],
                chartOnly: false,
                width: "100%",
                height: "100%",
                colorTheme: "light",
                showVolume: false,
                showMA: false,
                hideDateRanges: false,
                hideMarketStatus: false,
                hideSymbolLogo: false,
                scalePosition: "right",
                scaleMode: "Normal",
                fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
                fontSize: "10",
                noTimeScale: false,
                valuesTracking: "1",
                changeMode: "price-and-percent",
                chartType: "area",
                maLineColor: "#2962FF",
                maLineWidth: 1,
                maLength: 9,
                backgroundColor: "rgba(255, 255, 255, 0)",
                lineWidth: 2,
                lineType: 0,
                dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
                utm_source: "groq-stockbot.vercel.app",
                utm_medium: "widget_new",
                utm_campaign: "symbol-overview",
                "page-uri": "groq-stockbot.vercel.app/"
              })
            )}`}
            title="symbol overview TradingView widget"
            lang="en"
            style={{
              userSelect: "none",
              boxSizing: "border-box",
              display: "block",
              margin: "auto",
              height: "calc(50% - 16px)",
              width: "50%"
            }}
          ></iframe>
          <div
            ref={chatContainerInnerRef}
            className={`${chatContainerInnerClassName}`}
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
                      allToolIcons={allToolIcons}
                      showPromptLog={showPromptLog}
                      chatAnswerContainerInner={chatAnswerContainerInner}
                      hideProcessDetail={hideProcessDetail}
                    />
                  )
                }
                return (
                  <Question
                    key={item.id}
                    item={item}
                    questionIcon={questionIcon}
                    theme={themeBuilder?.theme}
                  />
                )
              })
            }
          </div>
        </div>
        <div
          className={`absolute bottom-0 ${(hasTryToAsk || !noChatInput || !noStopResponding) && chatFooterClassName}`}
          ref={chatFooterRef}
          style={{
            background: 'linear-gradient(0deg, #F9FAFB 40%, rgba(255, 255, 255, 0.00) 100%)',
          }}
        >
          <div
            ref={chatFooterInnerRef}
            className={`${chatFooterInnerClassName}`}
          >
            {
              !noStopResponding && isResponding && (
                <div className='flex justify-center mb-2'>
                  <Button onClick={onStopResponding}>
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
                  theme={themeBuilder?.theme}
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
