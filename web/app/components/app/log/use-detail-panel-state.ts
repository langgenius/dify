import type { ConversationDetail } from './list-utils'
import type { FeedbackFunc, IChatItem, SubmitAnnotationFunc } from '@/app/components/base/chat/chat/type'
import type {
  App,
} from '@/types/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getThreadMessages } from '@/app/components/base/chat/utils'
import { toast } from '@/app/components/base/ui/toast'
import { useAppContext } from '@/context/app-context'
import useTimestamp from '@/hooks/use-timestamp'
import { fetchChatMessages } from '@/service/log'
import { AppModeEnum } from '@/types/app'
import {
  applyAddedAnnotation,
  applyEditedAnnotation,
  buildChatState,
  buildDetailVarList,
  getDetailMessageFiles,
  getFormattedChatList,
  getNextRetryCount,
  isReverseScrollNearTop,
  MAX_RETRY_COUNT,
  mergeUniqueChatItems,
  removeAnnotationFromChatItems,
  shouldThrottleLoad,
} from './list-utils'

type AppStoreState = ReturnType<typeof useAppStore.getState>

type UseDetailPanelStateParams = {
  appDetail?: App
  detail: ConversationDetail
}

export const useDetailPanelState = ({ appDetail, detail }: UseDetailPanelStateParams) => {
  const { userProfile: { timezone } } = useAppContext()
  const { formatTime } = useTimestamp()
  const { t } = useTranslation()
  const {
    currentLogItem,
    currentLogModalActiveTab,
    setCurrentLogItem,
    setShowMessageLogModal,
    setShowPromptLogModal,
    showMessageLogModal,
    showPromptLogModal,
  } = useAppStore(useShallow((state: AppStoreState) => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))

  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedSiblingMessageId, setSelectedSiblingMessageId] = useState<string>()
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [width, setWidth] = useState(0)
  const [allChatItems, setAllChatItems] = useState<IChatItem[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const lastLoadTimeRef = useRef(0)
  const retryCountRef = useRef(0)
  const oldestAnswerIdRef = useRef<string | undefined>(undefined)
  const fetchInitiatedRef = useRef(false)

  const isChatMode = appDetail?.mode !== AppModeEnum.COMPLETION
  const isAdvanced = appDetail?.mode === AppModeEnum.ADVANCED_CHAT
  const messageDateTimeFormat = t('dateTimeFormat', { ns: 'appLog' }) as string

  const fetchData = useCallback(async () => {
    if (isLoadingRef.current || !hasMore)
      return

    if (abortControllerRef.current)
      abortControllerRef.current.abort()

    const controller = new AbortController()
    abortControllerRef.current = controller
    const currentRequestId = ++requestIdRef.current

    try {
      isLoadingRef.current = true

      const params: { conversation_id: string, limit: number, first_id?: string } = {
        conversation_id: detail.id,
        limit: 10,
      }

      if (oldestAnswerIdRef.current)
        params.first_id = oldestAnswerIdRef.current

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail?.id}/chat-messages`,
        params,
      })

      if (currentRequestId !== requestIdRef.current || controller.signal.aborted)
        return

      if (messageRes.data.length > 0)
        setVarValues(messageRes.data.at(-1)?.inputs ?? {})

      setHasMore(messageRes.has_more)

      const newItems = getFormattedChatList(messageRes.data, detail.id, timezone || 'UTC', messageDateTimeFormat)
      setAllChatItems(prevItems => mergeUniqueChatItems(prevItems, newItems).mergedItems)
    }
    catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError')
        return

      console.error('fetchData execution failed:', error)
    }
    finally {
      isLoadingRef.current = false
      if (abortControllerRef.current === controller)
        abortControllerRef.current = null
    }
  }, [appDetail?.id, detail.id, hasMore, messageDateTimeFormat, timezone])

  const { chatItemTree, oldestAnswerId, threadChatItems: defaultThreadChatItems } = useMemo(() => buildChatState(
    allChatItems,
    hasMore,
    detail?.model_config?.configs?.introduction,
  ), [allChatItems, detail?.model_config?.configs?.introduction, hasMore])

  useEffect(() => {
    if (oldestAnswerId)
      oldestAnswerIdRef.current = oldestAnswerId
  }, [oldestAnswerId])

  const threadChatItems = useMemo(() => {
    if (!selectedSiblingMessageId)
      return defaultThreadChatItems

    return getThreadMessages(chatItemTree, selectedSiblingMessageId)
  }, [chatItemTree, defaultThreadChatItems, selectedSiblingMessageId])

  const switchSibling = useCallback((siblingMessageId: string) => {
    setSelectedSiblingMessageId(siblingMessageId)
  }, [])

  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    setAllChatItems(prevItems => applyEditedAnnotation(prevItems, query, answer, index))
  }, [])

  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    setAllChatItems(prevItems => applyAddedAnnotation(prevItems, annotationId, authorName, query, answer, index))
  }, [])

  const handleAnnotationRemoved = useCallback(async (index: number): Promise<boolean> => {
    const annotation = allChatItems[index]?.annotation

    try {
      if (annotation?.id) {
        const { delAnnotation } = await import('@/service/annotation')
        await delAnnotation(appDetail?.id || '', annotation.id)
      }

      setAllChatItems(prevItems => removeAnnotationFromChatItems(prevItems, index))
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      return true
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      return false
    }
  }, [allChatItems, appDetail?.id, t])

  useEffect(() => {
    if (!appDetail?.id || !detail.id || appDetail.mode === AppModeEnum.COMPLETION || fetchInitiatedRef.current)
      return

    fetchInitiatedRef.current = true
    fetchData()
  }, [appDetail?.id, appDetail?.mode, detail.id, fetchData])

  const loadMoreMessages = useCallback(async () => {
    if (isLoading || !hasMore || !appDetail?.id || !detail.id)
      return

    const now = Date.now()
    if (shouldThrottleLoad(now, lastLoadTimeRef.current))
      return

    lastLoadTimeRef.current = now
    setIsLoading(true)

    try {
      const params: { conversation_id: string, limit: number, first_id?: string } = {
        conversation_id: detail.id,
        limit: 10,
      }

      if (oldestAnswerIdRef.current)
        params.first_id = oldestAnswerIdRef.current

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail.id}/chat-messages`,
        params,
      })

      if (!messageRes.data?.length) {
        setHasMore(false)
        retryCountRef.current = 0
        return
      }

      setVarValues(messageRes.data.at(-1)?.inputs ?? {})
      setHasMore(messageRes.has_more)

      const newItems = getFormattedChatList(messageRes.data, detail.id, timezone || 'UTC', messageDateTimeFormat)
      setAllChatItems((prevItems) => {
        const { mergedItems, uniqueNewItems } = mergeUniqueChatItems(prevItems, newItems)
        retryCountRef.current = getNextRetryCount(uniqueNewItems.length, prevItems.length, retryCountRef.current, MAX_RETRY_COUNT)
        return uniqueNewItems.length === 0 ? prevItems : mergedItems
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
  }, [appDetail?.id, detail.id, hasMore, isLoading, messageDateTimeFormat, timezone])

  const handleScroll = useCallback(() => {
    const scrollableDiv = document.getElementById('scrollableDiv')
    if (!scrollableDiv)
      return

    if (isReverseScrollNearTop(scrollableDiv.scrollTop, scrollableDiv.scrollHeight, scrollableDiv.clientHeight) && hasMore && !isLoading)
      loadMoreMessages()
  }, [hasMore, isLoading, loadMoreMessages])

  const varList = useMemo(() => buildDetailVarList(detail, varValues), [detail, varValues])
  const messageFiles = useMemo(() => getDetailMessageFiles(appDetail?.mode ?? AppModeEnum.CHAT, detail), [appDetail?.mode, detail])

  useEffect(() => {
    const adjustModalWidth = () => {
      if (!containerRef.current)
        return

      setWidth(document.body.clientWidth - (containerRef.current.clientWidth + 16) - 8)
    }

    const raf = requestAnimationFrame(adjustModalWidth)
    return () => cancelAnimationFrame(raf)
  }, [])

  return {
    containerRef,
    currentLogItem,
    currentLogModalActiveTab,
    formatTime,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
    handleScroll,
    hasMore,
    isAdvanced,
    isChatMode,
    messageDateTimeFormat,
    messageFiles,
    setCurrentLogItem,
    setShowMessageLogModal,
    setShowPromptLogModal,
    showMessageLogModal,
    showPromptLogModal,
    switchSibling,
    threadChatItems,
    varList,
    width,
  }
}

export type DetailPanelProps = {
  detail: ConversationDetail
  appDetail?: App
  onClose: () => void
  onFeedback: FeedbackFunc
  onSubmitAnnotation?: SubmitAnnotationFunc
}
