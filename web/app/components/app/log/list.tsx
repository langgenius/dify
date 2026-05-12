'use client'
import type { FC } from 'react'
import type { ChatItemInTree } from '../../base/chat/types'
import type { FeedbackFunc, FeedbackType, IChatItem, SubmitAnnotationFunc } from '@/app/components/base/chat/chat/type'
import type { ChatConversationGeneralDetail, ChatConversationsResponse, ChatMessagesRequest, CompletionConversationGeneralDetail, CompletionConversationsResponse, LogAnnotation } from '@/models/log'
import type { App } from '@/types/app'
import {
  HandThumbDownIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiCloseLine, RiEditFill } from '@remixicon/react'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { noop } from 'es-toolkit/function'
import { parseAsString, useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createContext, useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import ModelInfo from '@/app/components/app/log/model-info'
import { useStore as useAppStore } from '@/app/components/app/store'
import TextGeneration from '@/app/components/app/text-generate/item'
import ActionButton from '@/app/components/base/action-button'
import Chat from '@/app/components/base/chat/chat'
import CopyIcon from '@/app/components/base/copy-icon'
import Loading from '@/app/components/base/loading'
import MessageLogModal from '@/app/components/base/message-log-modal'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { useAppContext } from '@/context/app-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useTimestamp from '@/hooks/use-timestamp'
import { fetchChatMessages, updateLogMessageAnnotations, updateLogMessageFeedbacks } from '@/service/log'
import { AppSourceType } from '@/service/share'
import { useChatConversationDetail, useCompletionConversationDetail } from '@/service/use-log'
import { AppModeEnum } from '@/types/app'
import PromptLogModal from '../../base/prompt-log-modal'
import Indicator from '../../header/indicator'
import {
  applyAnnotationAdded,
  applyAnnotationEdited,
  applyAnnotationRemoved,
  buildChatThreadState,
  getCompletionMessageFiles,
  getConversationRowValues,
  getDetailVarList,
  getFormattedChatList,
  getThreadChatItems,
  isNearTopLoadMore,
  mergePaginatedChatItems,
  mergeUniqueChatItems,
} from './list-utils'
import VarPanel from './var-panel'

type AppStoreState = ReturnType<typeof useAppStore.getState>
type ConversationListItem = ChatConversationGeneralDetail | CompletionConversationGeneralDetail
type ConversationSelection = ConversationListItem | { id: string, isPlaceholder?: true }

dayjs.extend(utc)
dayjs.extend(timezone)

type IConversationList = {
  logs?: ChatConversationsResponse | CompletionConversationsResponse
  appDetail: App
  onRefresh: () => void
}

const defaultValue = 'N/A'

type IDrawerContext = {
  onClose: () => void
  appDetail?: App
}

type StatusCount = {
  paused: number
  success: number
  failed: number
  partial_success: number
}

const DrawerContext = createContext<IDrawerContext>({} as IDrawerContext)

/**
 * Icon component with numbers
 */
const HandThumbIconWithCount: FC<{ count: number, iconType: 'up' | 'down' }> = ({ count, iconType }) => {
  const classname = iconType === 'up' ? 'text-primary-600 bg-primary-50' : 'text-red-600 bg-red-50'
  const Icon = iconType === 'up' ? HandThumbUpIcon : HandThumbDownIcon
  return (
    <div className={`inline-flex w-fit items-center rounded-md p-1 text-xs ${classname} mr-1 last:mr-0`}>
      <Icon className="mr-0.5 h-3 w-3 rounded-md" />
      {count > 0 ? count : null}
    </div>
  )
}

const statusTdRender = (statusCount: StatusCount) => {
  if (!statusCount)
    return null

  if (statusCount.paused > 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="yellow" />
        <span className="text-util-colors-warning-warning-600">Pending</span>
      </div>
    )
  }
  else if (statusCount.partial_success + statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="green" />
        <span className="text-util-colors-green-green-600">Success</span>
      </div>
    )
  }
  else if (statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="green" />
        <span className="text-util-colors-green-green-600">Partial Success</span>
      </div>
    )
  }
  else {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="red" />
        <span className="text-util-colors-red-red-600">
          {statusCount.failed}
          {' '}
          {`${statusCount.failed > 1 ? 'Failures' : 'Failure'}`}
        </span>
      </div>
    )
  }
}

type IDetailPanel = {
  detail: any
  onFeedback: FeedbackFunc
  onSubmitAnnotation: SubmitAnnotationFunc
}

function DetailPanel({ detail, onFeedback }: IDetailPanel) {
  const MIN_ITEMS_FOR_SCROLL_LOADING = 8
  const SCROLL_DEBOUNCE_MS = 200
  const { userProfile: { timezone } } = useAppContext()
  const { formatTime } = useTimestamp()
  const { onClose, appDetail } = useContext(DrawerContext)
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal, showPromptLogModal, setShowPromptLogModal, currentLogModalActiveTab } = useAppStore(useShallow((state: AppStoreState) => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))
  const { t } = useTranslation()
  const [hasMore, setHasMore] = useState(true)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const isLoadingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const lastLoadTimeRef = useRef(0)
  const retryCountRef = useRef(0)
  const oldestAnswerIdRef = useRef<string | undefined>(undefined)
  const MAX_RETRY_COUNT = 3

  const [allChatItems, setAllChatItems] = useState<IChatItem[]>([])
  const [chatItemTree, setChatItemTree] = useState<ChatItemInTree[]>([])
  const [threadChatItems, setThreadChatItems] = useState<IChatItem[]>([])

  const fetchData = useCallback(async () => {
    if (isLoadingRef.current || !hasMore)
      return

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    const currentRequestId = ++requestIdRef.current

    try {
      isLoadingRef.current = true

      const params: ChatMessagesRequest = {
        conversation_id: detail.id,
        limit: 10,
      }
      // Use ref for pagination anchor to avoid stale closure issues
      if (oldestAnswerIdRef.current)
        params.first_id = oldestAnswerIdRef.current

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail?.id}/chat-messages`,
        params,
      })

      // Ignore stale responses
      if (currentRequestId !== requestIdRef.current || controller.signal.aborted)
        return
      if (messageRes.data.length > 0) {
        const varValues = messageRes.data.at(-1)!.inputs
        setVarValues(varValues)
      }
      setHasMore(messageRes.has_more)

      const newItems = getFormattedChatList(messageRes.data, detail.id, timezone!, t('dateTimeFormat', { ns: 'appLog' }) as string)

      // Use functional update to avoid stale state issues
      setAllChatItems((prevItems: IChatItem[]) => mergeUniqueChatItems(prevItems, newItems))
    }
    catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError')
        return
      console.error('fetchData execution failed:', err)
    }
    finally {
      isLoadingRef.current = false
      if (abortControllerRef.current === controller)
        abortControllerRef.current = null
    }
  }, [detail.id, hasMore, timezone, t, appDetail])

  // Derive chatItemTree, threadChatItems, and oldestAnswerIdRef from allChatItems
  useEffect(() => {
    if (allChatItems.length === 0)
      return

    const nextThreadState = buildChatThreadState({
      allChatItems,
      hasMore,
      introduction: detail?.model_config?.configs?.introduction,
    })
    setChatItemTree(nextThreadState.chatItemTree)
    setThreadChatItems(nextThreadState.threadChatItems)
    if (nextThreadState.oldestAnswerId)
      oldestAnswerIdRef.current = nextThreadState.oldestAnswerId
  }, [allChatItems, hasMore, detail?.model_config?.configs?.introduction])

  const switchSibling = useCallback((siblingMessageId: string) => {
    setThreadChatItems(getThreadChatItems(chatItemTree, siblingMessageId))
  }, [chatItemTree])

  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    setAllChatItems(applyAnnotationEdited(allChatItems, query, answer, index))
  }, [allChatItems])
  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    setAllChatItems(applyAnnotationAdded(allChatItems, annotationId, authorName, query, answer, index))
  }, [allChatItems])
  const handleAnnotationRemoved = useCallback(async (index: number): Promise<boolean> => {
    const annotation = allChatItems[index]?.annotation

    try {
      if (annotation?.id) {
        const { delAnnotation } = await import('@/service/annotation')
        await delAnnotation(appDetail?.id || '', annotation.id)
      }

      setAllChatItems(applyAnnotationRemoved(allChatItems, index))

      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }, [allChatItems, appDetail?.id, t])

  const fetchInitiated = useRef(false)

  // Only load initial messages, don't auto-load more
  useEffect(() => {
    if (appDetail?.id && detail.id && appDetail?.mode !== AppModeEnum.COMPLETION && !fetchInitiated.current) {
      // Mark as initialized, but don't auto-load more messages
      fetchInitiated.current = true
      // Still call fetchData to get initial messages
      fetchData()
    }
  }, [appDetail?.id, detail.id, appDetail?.mode, fetchData])

  const [isLoading, setIsLoading] = useState(false)

  const loadMoreMessages = useCallback(async () => {
    if (isLoading || !hasMore || !appDetail?.id || !detail.id)
      return

    // Throttle using ref to persist across re-renders
    const now = Date.now()
    if (now - lastLoadTimeRef.current < SCROLL_DEBOUNCE_MS)
      return
    lastLoadTimeRef.current = now

    setIsLoading(true)

    try {
      const params: ChatMessagesRequest = {
        conversation_id: detail.id,
        limit: 10,
      }

      // Use ref for pagination anchor to avoid stale closure issues
      if (oldestAnswerIdRef.current) {
        params.first_id = oldestAnswerIdRef.current
      }

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail.id}/chat-messages`,
        params,
      })

      if (!messageRes.data || messageRes.data.length === 0) {
        setHasMore(false)
        retryCountRef.current = 0
        return
      }

      if (messageRes.data.length > 0) {
        const varValues = messageRes.data.at(-1)!.inputs
        setVarValues(varValues)
      }

      setHasMore(messageRes.has_more)

      const newItems = getFormattedChatList(
        messageRes.data,
        detail.id,
        timezone!,
        t('dateTimeFormat', { ns: 'appLog' }) as string,
      )

      // Use functional update to get latest state and avoid stale closures
      setAllChatItems((prevItems: IChatItem[]) => {
        const nextItems = mergePaginatedChatItems({
          maxRetryCount: MAX_RETRY_COUNT,
          newItems,
          prevItems,
          retryCount: retryCountRef.current,
        })
        retryCountRef.current = nextItems.retryCount
        return nextItems.items
      })
    }
    catch (error) {
      console.error(error)
      setHasMore(false)
      retryCountRef.current = 0
    }
    finally {
      setIsLoading(false)
    }
  }, [detail.id, hasMore, isLoading, timezone, t, appDetail])

  const handleScroll = useCallback(() => {
    const scrollableDiv = document.getElementById('scrollableDiv')
    if (!scrollableDiv)
      return
    const clientHeight = scrollableDiv.clientHeight
    const scrollHeight = scrollableDiv.scrollHeight
    const currentScrollTop = scrollableDiv.scrollTop
    // currentScrollTop is negative due to column-reverse flex direction
    const isNearTop = isNearTopLoadMore({
      clientHeight,
      scrollHeight,
      scrollTop: currentScrollTop,
    })

    if (isNearTop && hasMore && !isLoading) {
      loadMoreMessages()
    }
  }, [hasMore, isLoading, loadMoreMessages])

  const isChatMode = appDetail?.mode !== AppModeEnum.COMPLETION
  const isAdvanced = appDetail?.mode === AppModeEnum.ADVANCED_CHAT

  const varList = getDetailVarList(detail, varValues)
  const message_files = getCompletionMessageFiles(detail, isChatMode)

  const [width, setWidth] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustModalWidth = () => {
    if (ref.current)
      setWidth(document.body.clientWidth - (ref.current?.clientWidth + 16) - 8)
  }

  useEffect(() => {
    const raf = requestAnimationFrame(adjustModalWidth)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={ref} className="flex h-full flex-col rounded-xl border-[0.5px] border-components-panel-border">
      {/* Panel Header */}
      <div className="flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pt-3 pr-3 pb-2 pl-4">
        <div className="shrink-0">
          <div className="mb-0.5 system-xs-semibold-uppercase text-text-primary">{isChatMode ? t('detail.conversationId', { ns: 'appLog' }) : t('detail.time', { ns: 'appLog' })}</div>
          {isChatMode && (
            <div className="flex items-center system-2xs-regular-uppercase text-text-secondary">
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <div className="truncate">{detail.id}</div>
                  )}
                />
                <TooltipContent>
                  {detail.id}
                </TooltipContent>
              </Tooltip>
              <CopyIcon content={detail.id} />
            </div>
          )}
          {!isChatMode && (
            <div className="system-2xs-regular-uppercase text-text-secondary">{formatTime(detail.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}</div>
          )}
        </div>
        <div className="flex grow flex-wrap items-center justify-end gap-y-1">
          {!isAdvanced && <ModelInfo model={detail.model_config.model} />}
        </div>
        <ActionButton size="l" aria-label={t('operation.close', { ns: 'common' })} onClick={onClose}>
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </ActionButton>
      </div>
      {/* Panel Body */}
      <div className="shrink-0 px-1 pt-1">
        <div className="rounded-t-xl bg-background-section-burn p-3 pb-2">
          {(varList.length > 0 || (!isChatMode && message_files.length > 0)) && (
            <VarPanel
              varList={varList}
              message_files={message_files}
            />
          )}
        </div>
      </div>
      <div className="mx-1 mb-1 grow overflow-auto rounded-b-xl bg-background-section-burn">
        {!isChatMode
          ? (
              <div className="px-6 py-4">
                <div className="flex h-[18px] items-center space-x-3">
                  <div className="system-xs-semibold-uppercase text-text-tertiary">{t('table.header.output', { ns: 'appLog' })}</div>
                  <div
                    className="h-px grow"
                    style={{
                      background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, rgb(243, 244, 246) 100%)',
                    }}
                  >
                  </div>
                </div>
                <TextGeneration
                  appSourceType={AppSourceType.webApp}
                  className="mt-2"
                  content={detail.message.answer}
                  messageId={detail.message.id}
                  isError={false}
                  onRetry={noop}
                  supportFeedback
                  feedback={detail.message.feedbacks.find((item: any) => item.from_source === 'admin')}
                  onFeedback={feedback => onFeedback(detail.message.id, feedback)}
                  isShowTextToSpeech
                  siteInfo={null}
                />
              </div>
            )
          : threadChatItems.length < MIN_ITEMS_FOR_SCROLL_LOADING ? (
            <div className="mb-4 pt-4">
              <Chat
                config={{
                  appId: appDetail?.id,
                  text_to_speech: {
                    enabled: true,
                  },
                  questionEditEnable: false,
                  supportAnnotation: true,
                  annotation_reply: {
                    enabled: true,
                  },
                  supportFeedback: true,
                } as any}
                chatList={threadChatItems}
                onAnnotationAdded={handleAnnotationAdded}
                onAnnotationEdited={handleAnnotationEdited}
                onAnnotationRemoved={handleAnnotationRemoved}
                onFeedback={onFeedback}
                noChatInput
                showPromptLog
                hideProcessDetail
                chatContainerInnerClassName="px-3"
                switchSibling={switchSibling}
              />
            </div>
          ) : (
            <div
              className="py-4"
              id="scrollableDiv"
              style={{
                display: 'flex',
                flexDirection: 'column-reverse',
                height: '100%',
                overflow: 'auto',
              }}
              onScroll={handleScroll}
            >
              {/* Put the scroll bar always on the bottom */}
              <div className="flex w-full flex-col-reverse" style={{ position: 'relative' }}>
                <Chat
                  config={{
                    appId: appDetail?.id,
                    text_to_speech: {
                      enabled: true,
                    },
                    questionEditEnable: false,
                    supportAnnotation: true,
                    annotation_reply: {
                      enabled: true,
                    },
                    supportFeedback: true,
                  } as any}
                  chatList={threadChatItems}
                  onAnnotationAdded={handleAnnotationAdded}
                  onAnnotationEdited={handleAnnotationEdited}
                  onAnnotationRemoved={handleAnnotationRemoved}
                  onFeedback={onFeedback}
                  noChatInput
                  showPromptLog
                  hideProcessDetail
                  chatContainerInnerClassName="px-3"
                  switchSibling={switchSibling}
                />
              </div>
              {hasMore && (
                <div className="py-3 text-center">
                  <div className="system-xs-regular text-text-tertiary">
                    {t('detail.loading', { ns: 'appLog' })}
                    ...
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
      {showMessageLogModal && (
        <WorkflowContextProvider>
          <MessageLogModal
            width={width}
            currentLogItem={currentLogItem}
            onCancel={() => {
              setCurrentLogItem()
              setShowMessageLogModal(false)
            }}
            defaultTab={currentLogModalActiveTab}
          />
        </WorkflowContextProvider>
      )}
      {!isChatMode && showPromptLogModal && (
        <PromptLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowPromptLogModal(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * Text App Conversation Detail Component
 */
const CompletionConversationDetailComp: FC<{ appId?: string, conversationId?: string }> = ({ appId, conversationId }) => {
  // Text Generator App Session Details Including Message List
  const { data: conversationDetail, refetch: conversationDetailMutate } = useCompletionConversationDetail(appId, conversationId)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating, content }: FeedbackType): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({
        url: `/apps/${appId}/feedbacks`,
        body: { message_id: mid, rating, content: content ?? undefined },
      })
      conversationDetailMutate()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      conversationDetailMutate()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }

  if (!conversationDetail)
    return null

  return (
    <DetailPanel
      detail={conversationDetail}
      onFeedback={handleFeedback}
      onSubmitAnnotation={handleAnnotation}
    />
  )
}

/**
 * Chat App Conversation Detail Component
 */
const ChatConversationDetailComp: FC<{ appId?: string, conversationId?: string }> = ({ appId, conversationId }) => {
  const { data: conversationDetail } = useChatConversationDetail(appId, conversationId)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating, content }: FeedbackType): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({
        url: `/apps/${appId}/feedbacks`,
        body: { message_id: mid, rating, content: content ?? undefined },
      })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }

  if (!conversationDetail)
    return null

  return (
    <DetailPanel
      detail={conversationDetail}
      onFeedback={handleFeedback}
      onSubmitAnnotation={handleAnnotation}
    />
  )
}

/**
 * Conversation list component including basic information
 */
const ConversationList: FC<IConversationList> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [conversationIdInUrl, setConversationIdInUrl] = useQueryState('conversation_id', parseAsString)

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [showDrawer, setShowDrawer] = useState<boolean>(false) // Whether to display the chat details drawer
  const [currentConversation, setCurrentConversation] = useState<ConversationSelection | undefined>() // Currently selected conversation
  const closingConversationIdRef = useRef<string | null>(null)
  const pendingConversationIdRef = useRef<string | null>(null)
  const pendingConversationCacheRef = useRef<ConversationSelection | undefined>(undefined)
  const isChatMode = appDetail.mode !== AppModeEnum.COMPLETION // Whether the app is a chat app
  const isChatflow = appDetail.mode === AppModeEnum.ADVANCED_CHAT // Whether the app is a chatflow app
  const { setShowPromptLogModal, setShowAgentLogModal, setShowMessageLogModal } = useAppStore(useShallow((state: AppStoreState) => ({
    setShowPromptLogModal: state.setShowPromptLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))

  const activeConversationId = conversationIdInUrl ?? pendingConversationIdRef.current ?? currentConversation?.id

  const handleRowClick = useCallback((log: ConversationListItem) => {
    if (conversationIdInUrl === log.id) {
      if (!showDrawer)
        setShowDrawer(true)

      if (!currentConversation || currentConversation.id !== log.id)
        setCurrentConversation(log)
      return
    }

    pendingConversationIdRef.current = log.id
    pendingConversationCacheRef.current = log
    if (!showDrawer)
      setShowDrawer(true)

    if (currentConversation?.id !== log.id)
      setCurrentConversation(undefined)

    void setConversationIdInUrl(log.id, { history: 'push' })
  }, [conversationIdInUrl, currentConversation, setConversationIdInUrl, showDrawer])

  const currentConversationId = currentConversation?.id

  useEffect(() => {
    if (!conversationIdInUrl) {
      if (pendingConversationIdRef.current)
        return

      if (showDrawer || currentConversationId) {
        setShowDrawer(false)
        setCurrentConversation(undefined)
      }
      closingConversationIdRef.current = null
      pendingConversationCacheRef.current = undefined
      return
    }

    if (closingConversationIdRef.current === conversationIdInUrl)
      return

    if (pendingConversationIdRef.current === conversationIdInUrl)
      pendingConversationIdRef.current = null

    const matchedConversation = logs?.data?.find((item: ConversationListItem) => item.id === conversationIdInUrl)
    const nextConversation: ConversationSelection = matchedConversation
      ?? pendingConversationCacheRef.current
      ?? { id: conversationIdInUrl, isPlaceholder: true }

    if (!showDrawer)
      setShowDrawer(true)

    if (!currentConversation || currentConversation.id !== conversationIdInUrl || (!('created_at' in currentConversation) && matchedConversation))
      setCurrentConversation(nextConversation)

    if (pendingConversationCacheRef.current?.id === conversationIdInUrl || matchedConversation)
      pendingConversationCacheRef.current = undefined
  }, [conversationIdInUrl, currentConversation, currentConversationId, logs?.data, showDrawer])

  const onCloseDrawer = useCallback(() => {
    onRefresh()
    setShowDrawer(false)
    setCurrentConversation(undefined)
    setShowPromptLogModal(false)
    setShowAgentLogModal(false)
    setShowMessageLogModal(false)
    pendingConversationIdRef.current = null
    pendingConversationCacheRef.current = undefined
    closingConversationIdRef.current = conversationIdInUrl ?? null

    if (conversationIdInUrl)
      void setConversationIdInUrl(null, { history: 'replace' })
  }, [conversationIdInUrl, onRefresh, setConversationIdInUrl, setShowAgentLogModal, setShowMessageLogModal, setShowPromptLogModal])

  // Annotated data needs to be highlighted
  const renderTdValue = (value: string | number | null, isEmptyStyle: boolean, isHighlight = false, annotation?: LogAnnotation) => {
    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className={cn(isEmptyStyle ? 'text-text-quaternary' : 'text-text-secondary', !isHighlight ? '' : 'bg-orange-100', 'overflow-hidden system-sm-regular text-ellipsis whitespace-nowrap')}>
              {value || '-'}
            </div>
          )}
        />
        <TooltipContent className={(isHighlight && !isChatMode) ? '' : 'hidden!'}>
          <span className="inline-flex items-center text-xs text-text-tertiary">
            <RiEditFill className="mr-1 h-3 w-3" />
            {`${t('detail.annotationTip', { ns: 'appLog', user: annotation?.account?.name })} ${formatTime(annotation?.created_at || dayjs().unix(), 'MM-DD hh:mm A')}`}
          </span>
        </TooltipContent>
      </Tooltip>
    )
  }

  if (!logs)
    return <Loading />

  return (
    <div className="relative mt-2 grow overflow-x-auto">
      <table className={cn('w-full min-w-[440px] border-collapse border-0')}>
        <thead className="system-xs-medium-uppercase text-text-tertiary">
          <tr>
            <td className="w-5 rounded-l-lg bg-background-section-burn pr-1 pl-2 whitespace-nowrap"></td>
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{isChatMode ? t('table.header.summary', { ns: 'appLog' }) : t('table.header.input', { ns: 'appLog' })}</td>
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.endUser', { ns: 'appLog' })}</td>
            {isChatflow && <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.status', { ns: 'appLog' })}</td>}
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{isChatMode ? t('table.header.messageCount', { ns: 'appLog' }) : t('table.header.output', { ns: 'appLog' })}</td>
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.userRate', { ns: 'appLog' })}</td>
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.adminRate', { ns: 'appLog' })}</td>
            <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.updatedTime', { ns: 'appLog' })}</td>
            <td className="rounded-r-lg bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.time', { ns: 'appLog' })}</td>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {logs.data.map((log: any) => {
            const { endUser, isLeftEmpty, isRightEmpty, leftValue, rightValue } = getConversationRowValues({
              isChatMode,
              log,
              noChatLabel: t('table.empty.noChat', { ns: 'appLog' }),
              noOutputLabel: t('table.empty.noOutput', { ns: 'appLog' }),
            })
            return (
              <tr
                key={log.id}
                className={cn('cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover', activeConversationId !== log.id ? '' : 'bg-background-default-hover')}
                onClick={() => handleRowClick(log)}
              >
                <td className="h-4">
                  {!log.read_at && (
                    <div className="flex items-center p-3 pr-0.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-sm bg-util-colors-blue-blue-500"></span>
                    </div>
                  )}
                </td>
                <td className="w-[160px] p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                  {renderTdValue(leftValue, isLeftEmpty, isChatMode && log.annotated)}
                </td>
                <td className="p-3 pr-2">{renderTdValue(endUser || defaultValue, !endUser)}</td>
                {isChatflow && (
                  <td className="w-[160px] p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                    {statusTdRender(log.status_count)}
                  </td>
                )}
                <td className="p-3 pr-2" style={{ maxWidth: isChatMode ? 100 : 200 }}>
                  {renderTdValue(rightValue, isRightEmpty, !isChatMode && !!log.annotation?.content, log.annotation)}
                </td>
                <td className="p-3 pr-2">
                  {(!log.user_feedback_stats.like && !log.user_feedback_stats.dislike)
                    ? renderTdValue(defaultValue, true)
                    : (
                        <>
                          {!!log.user_feedback_stats.like && <HandThumbIconWithCount iconType="up" count={log.user_feedback_stats.like} />}
                          {!!log.user_feedback_stats.dislike && <HandThumbIconWithCount iconType="down" count={log.user_feedback_stats.dislike} />}
                        </>
                      )}
                </td>
                <td className="p-3 pr-2">
                  {(!log.admin_feedback_stats.like && !log.admin_feedback_stats.dislike)
                    ? renderTdValue(defaultValue, true)
                    : (
                        <>
                          {!!log.admin_feedback_stats.like && <HandThumbIconWithCount iconType="up" count={log.admin_feedback_stats.like} />}
                          {!!log.admin_feedback_stats.dislike && <HandThumbIconWithCount iconType="down" count={log.admin_feedback_stats.dislike} />}
                        </>
                      )}
                </td>
                <td className="w-[160px] p-3 pr-2">{formatTime(log.updated_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}</td>
                <td className="w-[160px] p-3 pr-2">{formatTime(log.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Drawer
        open={showDrawer}
        modal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open)
            onCloseDrawer()
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop className={cn(!isMobile && 'bg-transparent')} />
          <DrawerViewport>
            <DrawerPopup className="bg-components-panel-bg p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-4 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-[640px] data-[swipe-direction=right]:rounded-xl">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <DrawerContext.Provider value={{
                  onClose: onCloseDrawer,
                  appDetail,
                }}
                >
                  {isChatMode
                    ? <ChatConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />
                    : <CompletionConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />}
                </DrawerContext.Provider>
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>
  )
}

export default ConversationList
