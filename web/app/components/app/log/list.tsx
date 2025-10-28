'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  HandThumbDownIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/outline'
import { RiCloseLine, RiEditFill } from '@remixicon/react'
import { get } from 'lodash-es'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { createContext, useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ChatItemInTree } from '../../base/chat/types'
import Indicator from '../../header/indicator'
import VarPanel from './var-panel'
import type { FeedbackFunc, FeedbackType, IChatItem, SubmitAnnotationFunc } from '@/app/components/base/chat/chat/type'
import type { Annotation, ChatConversationGeneralDetail, ChatConversationsResponse, ChatMessage, ChatMessagesRequest, CompletionConversationGeneralDetail, CompletionConversationsResponse, LogAnnotation } from '@/models/log'
import type { App } from '@/types/app'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Chat from '@/app/components/base/chat/chat'
import { ToastContext } from '@/app/components/base/toast'
import { fetchChatConversationDetail, fetchChatMessages, fetchCompletionConversationDetail, updateLogMessageAnnotations, updateLogMessageFeedbacks } from '@/service/log'
import ModelInfo from '@/app/components/app/log/model-info'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import TextGeneration from '@/app/components/app/text-generate/item'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import MessageLogModal from '@/app/components/base/message-log-modal'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import useTimestamp from '@/hooks/use-timestamp'
import Tooltip from '@/app/components/base/tooltip'
import CopyIcon from '@/app/components/base/copy-icon'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import cn from '@/utils/classnames'
import { noop } from 'lodash-es'
import PromptLogModal from '../../base/prompt-log-modal'

type AppStoreState = ReturnType<typeof useAppStore.getState>
type ConversationListItem = ChatConversationGeneralDetail | CompletionConversationGeneralDetail
type ConversationSelection = ConversationListItem | { id: string; isPlaceholder?: true }

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
  success: number
  failed: number
  partial_success: number
}

const DrawerContext = createContext<IDrawerContext>({} as IDrawerContext)

/**
 * Icon component with numbers
 */
const HandThumbIconWithCount: FC<{ count: number; iconType: 'up' | 'down' }> = ({ count, iconType }) => {
  const classname = iconType === 'up' ? 'text-primary-600 bg-primary-50' : 'text-red-600 bg-red-50'
  const Icon = iconType === 'up' ? HandThumbUpIcon : HandThumbDownIcon
  return <div className={`inline-flex w-fit items-center rounded-md p-1 text-xs ${classname} mr-1 last:mr-0`}>
    <Icon className={'mr-0.5 h-3 w-3 rounded-md'} />
    {count > 0 ? count : null}
  </div>
}

const statusTdRender = (statusCount: StatusCount) => {
  if (!statusCount)
    return null

  if (statusCount.partial_success + statusCount.failed === 0) {
    return (
      <div className='system-xs-semibold-uppercase inline-flex items-center gap-1'>
        <Indicator color={'green'} />
        <span className='text-util-colors-green-green-600'>Success</span>
      </div>
    )
  }
  else if (statusCount.failed === 0) {
    return (
      <div className='system-xs-semibold-uppercase inline-flex items-center gap-1'>
        <Indicator color={'green'} />
        <span className='text-util-colors-green-green-600'>Partial Success</span>
      </div>
    )
  }
  else {
    return (
      <div className='system-xs-semibold-uppercase inline-flex items-center gap-1'>
        <Indicator color={'red'} />
        <span className='text-util-colors-red-red-600'>{statusCount.failed} {`${statusCount.failed > 1 ? 'Failures' : 'Failure'}`}</span>
      </div>
    )
  }
}

const getFormattedChatList = (messages: ChatMessage[], conversationId: string, timezone: string, format: string) => {
  const newChatList: IChatItem[] = []
  try {
    messages.forEach((item: ChatMessage) => {
      const questionFiles = item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
      newChatList.push({
        id: `question-${item.id}`,
        content: item.inputs.query || item.inputs.default_input || item.query, // text generation: item.inputs.query; chat: item.query
        isAnswer: false,
        message_files: getProcessedFilesFromResponse(questionFiles.map((item: any) => ({ ...item, related_id: item.id }))),
        parentMessageId: item.parent_message_id || undefined,
      })

      const answerFiles = item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
      newChatList.push({
        id: item.id,
        content: item.answer,
        agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
        feedback: item.feedbacks.find(item => item.from_source === 'user'), // user feedback
        adminFeedback: item.feedbacks.find(item => item.from_source === 'admin'), // admin feedback
        feedbackDisabled: false,
        isAnswer: true,
        message_files: getProcessedFilesFromResponse(answerFiles.map((item: any) => ({ ...item, related_id: item.id }))),
        log: [
          ...item.message,
          ...(item.message[item.message.length - 1]?.role !== 'assistant'
            ? [
              {
                role: 'assistant',
                text: item.answer,
                files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
              },
            ]
            : []),
        ] as IChatItem['log'],
        workflow_run_id: item.workflow_run_id,
        conversationId,
        input: {
          inputs: item.inputs,
          query: item.query,
        },
        more: {
          time: dayjs.unix(item.created_at).tz(timezone).format(format),
          tokens: item.answer_tokens + item.message_tokens,
          latency: item.provider_response_latency.toFixed(2),
        },
        citation: item.metadata?.retriever_resources,
        annotation: (() => {
          if (item.annotation_hit_history) {
            return {
              id: item.annotation_hit_history.annotation_id,
              authorName: item.annotation_hit_history.annotation_create_account?.name || 'N/A',
              created_at: item.annotation_hit_history.created_at,
            }
          }

          if (item.annotation) {
            return {
              id: item.annotation.id,
              authorName: item.annotation.account.name,
              logAnnotation: item.annotation,
              created_at: 0,
            }
          }

          return undefined
        })(),
        parentMessageId: `question-${item.id}`,
      })
    })

    return newChatList
  }
  catch (error) {
    console.error('getFormattedChatList processing failed:', error)
    throw error
  }
}

type IDetailPanel = {
  detail: any
  onFeedback: FeedbackFunc
  onSubmitAnnotation: SubmitAnnotationFunc
}

function DetailPanel({ detail, onFeedback }: IDetailPanel) {
  const MIN_ITEMS_FOR_SCROLL_LOADING = 8
  const SCROLL_THRESHOLD_PX = 50
  const SCROLL_DEBOUNCE_MS = 200
  const { userProfile: { timezone } } = useAppContext()
  const { formatTime } = useTimestamp()
  const { onClose, appDetail } = useContext(DrawerContext)
  const { notify } = useContext(ToastContext)
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

  const [allChatItems, setAllChatItems] = useState<IChatItem[]>([])
  const [chatItemTree, setChatItemTree] = useState<ChatItemInTree[]>([])
  const [threadChatItems, setThreadChatItems] = useState<IChatItem[]>([])

  const fetchData = useCallback(async () => {
    if (isLoadingRef.current)
      return

    try {
      isLoadingRef.current = true

      if (!hasMore)
        return

      const params: ChatMessagesRequest = {
        conversation_id: detail.id,
        limit: 10,
      }
      // Use the oldest answer item ID for pagination
      const answerItems = allChatItems.filter(item => item.isAnswer)
      const oldestAnswerItem = answerItems[answerItems.length - 1]
      if (oldestAnswerItem?.id)
        params.first_id = oldestAnswerItem.id
      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail?.id}/chat-messages`,
        params,
      })
      if (messageRes.data.length > 0) {
        const varValues = messageRes.data.at(-1)!.inputs
        setVarValues(varValues)
      }
      setHasMore(messageRes.has_more)

      const newAllChatItems = [
        ...getFormattedChatList(messageRes.data, detail.id, timezone!, t('appLog.dateTimeFormat') as string),
        ...allChatItems,
      ]
      setAllChatItems(newAllChatItems)

      let tree = buildChatItemTree(newAllChatItems)
      if (messageRes.has_more === false && detail?.model_config?.configs?.introduction) {
        tree = [{
          id: 'introduction',
          isAnswer: true,
          isOpeningStatement: true,
          content: detail?.model_config?.configs?.introduction ?? 'hello',
          feedbackDisabled: true,
          children: tree,
        }]
      }
      setChatItemTree(tree)

      const lastMessageId = newAllChatItems.length > 0 ? newAllChatItems[newAllChatItems.length - 1].id : undefined
      setThreadChatItems(getThreadMessages(tree, lastMessageId))
    }
    catch (err) {
      console.error('fetchData execution failed:', err)
    }
    finally {
      isLoadingRef.current = false
    }
  }, [allChatItems, detail.id, hasMore, timezone, t, appDetail, detail?.model_config?.configs?.introduction])

  const switchSibling = useCallback((siblingMessageId: string) => {
    const newThreadChatItems = getThreadMessages(chatItemTree, siblingMessageId)
    setThreadChatItems(newThreadChatItems)
  }, [chatItemTree])

  const handleAnnotationEdited = useCallback((query: string, answer: string, index: number) => {
    setAllChatItems(allChatItems.map((item, i) => {
      if (i === index - 1) {
        return {
          ...item,
          content: query,
        }
      }
      if (i === index) {
        return {
          ...item,
          annotation: {
            ...item.annotation,
            logAnnotation: {
              ...item.annotation?.logAnnotation,
              content: answer,
            },
          } as any,
        }
      }
      return item
    }))
  }, [allChatItems])
  const handleAnnotationAdded = useCallback((annotationId: string, authorName: string, query: string, answer: string, index: number) => {
    setAllChatItems(allChatItems.map((item, i) => {
      if (i === index - 1) {
        return {
          ...item,
          content: query,
        }
      }
      if (i === index) {
        const answerItem = {
          ...item,
          content: item.content,
          annotation: {
            id: annotationId,
            authorName,
            logAnnotation: {
              content: answer,
              account: {
                id: '',
                name: authorName,
                email: '',
              },
            },
          } as Annotation,
        }
        return answerItem
      }
      return item
    }))
  }, [allChatItems])
  const handleAnnotationRemoved = useCallback(async (index: number): Promise<boolean> => {
    const annotation = allChatItems[index]?.annotation

    try {
      if (annotation?.id) {
        const { delAnnotation } = await import('@/service/annotation')
        await delAnnotation(appDetail?.id || '', annotation.id)
      }

      setAllChatItems(allChatItems.map((item, i) => {
        if (i === index) {
          return {
            ...item,
            content: item.content,
            annotation: undefined,
          }
        }
        return item
      }))

      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }, [allChatItems, appDetail?.id, t])

  const fetchInitiated = useRef(false)

  // Only load initial messages, don't auto-load more
  useEffect(() => {
    if (appDetail?.id && detail.id && appDetail?.mode !== 'completion' && !fetchInitiated.current) {
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

    setIsLoading(true)

    try {
      const params: ChatMessagesRequest = {
        conversation_id: detail.id,
        limit: 10,
      }

      // Use the earliest response item as the first_id
      const answerItems = allChatItems.filter(item => item.isAnswer)
      const oldestAnswerItem = answerItems[answerItems.length - 1]
      if (oldestAnswerItem?.id) {
        params.first_id = oldestAnswerItem.id
      }
      else if (allChatItems.length > 0 && allChatItems[0]?.id) {
        const firstId = allChatItems[0].id.replace('question-', '').replace('answer-', '')
        params.first_id = firstId
      }

      const messageRes = await fetchChatMessages({
        url: `/apps/${appDetail.id}/chat-messages`,
        params,
      })

      if (!messageRes.data || messageRes.data.length === 0) {
        setHasMore(false)
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
        t('appLog.dateTimeFormat') as string,
      )

      // Check for duplicate messages
      const existingIds = new Set(allChatItems.map(item => item.id))
      const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id))

      if (uniqueNewItems.length === 0) {
        if (allChatItems.length > 1) {
          const nextId = allChatItems[1].id.replace('question-', '').replace('answer-', '')

          const retryParams = {
            ...params,
            first_id: nextId,
          }

          const retryRes = await fetchChatMessages({
            url: `/apps/${appDetail.id}/chat-messages`,
            params: retryParams,
          })

          if (retryRes.data && retryRes.data.length > 0) {
            const retryItems = getFormattedChatList(
              retryRes.data,
              detail.id,
              timezone!,
              t('appLog.dateTimeFormat') as string,
            )

            const retryUniqueItems = retryItems.filter(item => !existingIds.has(item.id))
            if (retryUniqueItems.length > 0) {
              const newAllChatItems = [
                ...retryUniqueItems,
                ...allChatItems,
              ]

              setAllChatItems(newAllChatItems)

              let tree = buildChatItemTree(newAllChatItems)
              if (retryRes.has_more === false && detail?.model_config?.configs?.introduction) {
                tree = [{
                  id: 'introduction',
                  isAnswer: true,
                  isOpeningStatement: true,
                  content: detail?.model_config?.configs?.introduction ?? 'hello',
                  feedbackDisabled: true,
                  children: tree,
                }]
              }
              setChatItemTree(tree)
              setHasMore(retryRes.has_more)
              setThreadChatItems(getThreadMessages(tree, newAllChatItems.at(-1)?.id))
              return
            }
          }
        }
      }

      const newAllChatItems = [
        ...uniqueNewItems,
        ...allChatItems,
      ]

      setAllChatItems(newAllChatItems)

      let tree = buildChatItemTree(newAllChatItems)
      if (messageRes.has_more === false && detail?.model_config?.configs?.introduction) {
        tree = [{
          id: 'introduction',
          isAnswer: true,
          isOpeningStatement: true,
          content: detail?.model_config?.configs?.introduction ?? 'hello',
          feedbackDisabled: true,
          children: tree,
        }]
      }
      setChatItemTree(tree)

      setThreadChatItems(getThreadMessages(tree, newAllChatItems.at(-1)?.id))
    }
    catch (error) {
      console.error(error)
      setHasMore(false)
    }
    finally {
      setIsLoading(false)
    }
  }, [allChatItems, detail.id, hasMore, isLoading, timezone, t, appDetail])

  useEffect(() => {
    const scrollableDiv = document.getElementById('scrollableDiv')
    const outerDiv = scrollableDiv?.parentElement
    const chatContainer = document.querySelector('.mx-1.mb-1.grow.overflow-auto') as HTMLElement

    let scrollContainer: HTMLElement | null = null

    if (outerDiv && outerDiv.scrollHeight > outerDiv.clientHeight) {
      scrollContainer = outerDiv
    }
    else if (scrollableDiv && scrollableDiv.scrollHeight > scrollableDiv.clientHeight) {
      scrollContainer = scrollableDiv
    }
    else if (chatContainer && chatContainer.scrollHeight > chatContainer.clientHeight) {
      scrollContainer = chatContainer
    }
    else {
      const possibleContainers = document.querySelectorAll('.overflow-auto, .overflow-y-auto')
      for (let i = 0; i < possibleContainers.length; i++) {
        const container = possibleContainers[i] as HTMLElement
        if (container.scrollHeight > container.clientHeight) {
          scrollContainer = container
          break
        }
      }
    }

    if (!scrollContainer)
      return

    let lastLoadTime = 0
    const throttleDelay = 200

    const handleScroll = () => {
      const currentScrollTop = scrollContainer!.scrollTop
      const scrollHeight = scrollContainer!.scrollHeight
      const clientHeight = scrollContainer!.clientHeight

      const distanceFromTop = currentScrollTop
      const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight

      const now = Date.now()

      const isNearTop = distanceFromTop < 30
      // eslint-disable-next-line sonarjs/no-unused-vars
      const _distanceFromBottom = distanceFromBottom < 30
      if (isNearTop && hasMore && !isLoading && (now - lastLoadTime > throttleDelay)) {
        lastLoadTime = now
        loadMoreMessages()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0)
        handleScroll()
    }
    scrollContainer.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      scrollContainer!.removeEventListener('scroll', handleScroll)
      scrollContainer!.removeEventListener('wheel', handleWheel)
    }
  }, [hasMore, isLoading, loadMoreMessages])

  const isChatMode = appDetail?.mode !== 'completion'
  const isAdvanced = appDetail?.mode === 'advanced-chat'

  const varList = (detail.model_config as any).user_input_form?.map((item: any) => {
    const itemContent = item[Object.keys(item)[0]]
    return {
      label: itemContent.variable,
      value: varValues[itemContent.variable] || detail.message?.inputs?.[itemContent.variable],
    }
  }) || []
  const message_files = (!isChatMode && detail.message.message_files && detail.message.message_files.length > 0)
    ? detail.message.message_files.map((item: any) => item.url)
    : []

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

  // Add scroll listener to ensure loading is triggered
  useEffect(() => {
    if (threadChatItems.length >= MIN_ITEMS_FOR_SCROLL_LOADING && hasMore) {
      const scrollableDiv = document.getElementById('scrollableDiv')

      if (scrollableDiv) {
        let loadingTimeout: NodeJS.Timeout | null = null

        const handleScroll = () => {
          const { scrollTop } = scrollableDiv

          // Trigger loading when scrolling near the top
          if (scrollTop < SCROLL_THRESHOLD_PX && !isLoadingRef.current) {
            if (loadingTimeout)
              clearTimeout(loadingTimeout)

            loadingTimeout = setTimeout(fetchData, SCROLL_DEBOUNCE_MS) // 200ms debounce
          }
        }

        scrollableDiv.addEventListener('scroll', handleScroll)
        return () => {
          scrollableDiv.removeEventListener('scroll', handleScroll)
          if (loadingTimeout)
            clearTimeout(loadingTimeout)
        }
      }
    }
  }, [threadChatItems.length, hasMore, fetchData])

  return (
    <div ref={ref} className='flex h-full flex-col rounded-xl border-[0.5px] border-components-panel-border'>
      {/* Panel Header */}
      <div className='flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pb-2 pl-4 pr-3 pt-3'>
        <div className='shrink-0'>
          <div className='system-xs-semibold-uppercase mb-0.5 text-text-primary'>{isChatMode ? t('appLog.detail.conversationId') : t('appLog.detail.time')}</div>
          {isChatMode && (
            <div className='system-2xs-regular-uppercase flex items-center text-text-secondary'>
              <Tooltip
                popupContent={detail.id}
              >
                <div className='truncate'>{detail.id}</div>
              </Tooltip>
              <CopyIcon content={detail.id} />
            </div>
          )}
          {!isChatMode && (
            <div className='system-2xs-regular-uppercase text-text-secondary'>{formatTime(detail.created_at, t('appLog.dateTimeFormat') as string)}</div>
          )}
        </div>
        <div className='flex grow flex-wrap items-center justify-end gap-y-1'>
          {!isAdvanced && <ModelInfo model={detail.model_config.model} />}
        </div>
        <ActionButton size='l' onClick={onClose}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </ActionButton>
      </div>
      {/* Panel Body */}
      <div className='shrink-0 px-1 pt-1'>
        <div className='rounded-t-xl bg-background-section-burn p-3 pb-2'>
          {(varList.length > 0 || (!isChatMode && message_files.length > 0)) && (
            <VarPanel
              varList={varList}
              message_files={message_files}
            />
          )}
        </div>
      </div>
      <div className='mx-1 mb-1 grow overflow-auto rounded-b-xl bg-background-section-burn'>
        {!isChatMode
          ? <div className="px-6 py-4">
            <div className='flex h-[18px] items-center space-x-3'>
              <div className='system-xs-semibold-uppercase text-text-tertiary'>{t('appLog.table.header.output')}</div>
              <div className='h-px grow' style={{
                background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, rgb(243, 244, 246) 100%)',
              }}></div>
            </div>
            <TextGeneration
              className='mt-2'
              content={detail.message.answer}
              messageId={detail.message.id}
              isError={false}
              onRetry={noop}
              isInstalledApp={false}
              supportFeedback
              feedback={detail.message.feedbacks.find((item: any) => item.from_source === 'admin')}
              onFeedback={feedback => onFeedback(detail.message.id, feedback)}
              isShowTextToSpeech
              siteInfo={null}
            />
          </div>
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
                chatContainerInnerClassName='px-3'
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
              }}>
              {/* Put the scroll bar always on the bottom */}
              <div className="flex w-full flex-col-reverse" style={{ position: 'relative' }}>
                {/* Loading state indicator - only shown when loading */}
                {hasMore && isLoading && (
                  <div className="sticky left-0 right-0 top-0 z-10 bg-primary-50/40 py-3 text-center">
                    <div className='system-xs-regular text-text-tertiary'>
                      {t('appLog.detail.loading')}...
                    </div>
                  </div>
                )}

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
                  chatContainerInnerClassName='px-3'
                  switchSibling={switchSibling}
                />
              </div>
            </div>
          )
        }
      </div>
      {showMessageLogModal && (
        <MessageLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowMessageLogModal(false)
          }}
          defaultTab={currentLogModalActiveTab}
        />
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
const CompletionConversationDetailComp: FC<{ appId?: string; conversationId?: string }> = ({ appId, conversationId }) => {
  // Text Generator App Session Details Including Message List
  const detailParams = ({ url: `/apps/${appId}/completion-conversations/${conversationId}` })
  const { data: conversationDetail, mutate: conversationDetailMutate } = useSWR(() => (appId && conversationId) ? detailParams : null, fetchCompletionConversationDetail)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating }: FeedbackType): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({ url: `/apps/${appId}/feedbacks`, body: { message_id: mid, rating } })
      conversationDetailMutate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      conversationDetailMutate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  if (!conversationDetail)
    return null

  return <DetailPanel
    detail={conversationDetail}
    onFeedback={handleFeedback}
    onSubmitAnnotation={handleAnnotation}
  />
}

/**
   * Chat App Conversation Detail Component
   */
const ChatConversationDetailComp: FC<{ appId?: string; conversationId?: string }> = ({ appId, conversationId }) => {
  const detailParams = { url: `/apps/${appId}/chat-conversations/${conversationId}` }
  const { data: conversationDetail } = useSWR(() => (appId && conversationId) ? detailParams : null, fetchChatConversationDetail)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()

  const handleFeedback = async (mid: string, { rating }: FeedbackType): Promise<boolean> => {
    try {
      await updateLogMessageFeedbacks({ url: `/apps/${appId}/feedbacks`, body: { message_id: mid, rating } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  const handleAnnotation = async (mid: string, value: string): Promise<boolean> => {
    try {
      await updateLogMessageAnnotations({ url: `/apps/${appId}/annotations`, body: { message_id: mid, content: value } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      return false
    }
  }

  if (!conversationDetail)
    return null

  return <DetailPanel
    detail={conversationDetail}
    onFeedback={handleFeedback}
    onSubmitAnnotation={handleAnnotation}
  />
}

/**
   * Conversation list component including basic information
   */
const ConversationList: FC<IConversationList> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const conversationIdInUrl = searchParams.get('conversation_id') ?? undefined

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [showDrawer, setShowDrawer] = useState<boolean>(false) // Whether to display the chat details drawer
  const [currentConversation, setCurrentConversation] = useState<ConversationSelection | undefined>() // Currently selected conversation
  const closingConversationIdRef = useRef<string | null>(null)
  const pendingConversationIdRef = useRef<string | null>(null)
  const pendingConversationCacheRef = useRef<ConversationSelection | undefined>(undefined)
  const isChatMode = appDetail.mode !== 'completion' // Whether the app is a chat app
  const isChatflow = appDetail.mode === 'advanced-chat' // Whether the app is a chatflow app
  const { setShowPromptLogModal, setShowAgentLogModal, setShowMessageLogModal } = useAppStore(useShallow((state: AppStoreState) => ({
    setShowPromptLogModal: state.setShowPromptLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))

  const activeConversationId = conversationIdInUrl ?? pendingConversationIdRef.current ?? currentConversation?.id

  const buildUrlWithConversation = useCallback((conversationId?: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (conversationId)
      params.set('conversation_id', conversationId)
    else
      params.delete('conversation_id')

    const queryString = params.toString()
    return queryString ? `${pathname}?${queryString}` : pathname
  }, [pathname, searchParams])

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

    router.push(buildUrlWithConversation(log.id), { scroll: false })
  }, [buildUrlWithConversation, conversationIdInUrl, currentConversation, router, showDrawer])

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
  }, [conversationIdInUrl, currentConversation, isChatMode, logs?.data, showDrawer])

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
      router.replace(buildUrlWithConversation(), { scroll: false })
  }, [buildUrlWithConversation, conversationIdInUrl, onRefresh, router, setShowAgentLogModal, setShowMessageLogModal, setShowPromptLogModal])

  // Annotated data needs to be highlighted
  const renderTdValue = (value: string | number | null, isEmptyStyle: boolean, isHighlight = false, annotation?: LogAnnotation) => {
    return (
      <Tooltip
        popupContent={
          <span className='inline-flex items-center text-xs text-text-tertiary'>
            <RiEditFill className='mr-1 h-3 w-3' />{`${t('appLog.detail.annotationTip', { user: annotation?.account?.name })} ${formatTime(annotation?.created_at || dayjs().unix(), 'MM-DD hh:mm A')}`}
          </span>
        }
        popupClassName={(isHighlight && !isChatMode) ? '' : '!hidden'}
      >
        <div className={cn(isEmptyStyle ? 'text-text-quaternary' : 'text-text-secondary', !isHighlight ? '' : 'bg-orange-100', 'system-sm-regular overflow-hidden text-ellipsis whitespace-nowrap')}>
          {value || '-'}
        </div>
      </Tooltip>
    )
  }

  if (!logs)
    return <Loading />

  return (
    <div className='relative grow overflow-x-auto'>
      <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1'></td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{isChatMode ? t('appLog.table.header.summary') : t('appLog.table.header.input')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.endUser')}</td>
            {isChatflow && <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.status')}</td>}
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{isChatMode ? t('appLog.table.header.messageCount') : t('appLog.table.header.output')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.userRate')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.adminRate')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.updatedTime')}</td>
            <td className='whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.time')}</td>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {logs.data.map((log: any) => {
            const endUser = log.from_end_user_session_id || log.from_account_name
            const leftValue = get(log, isChatMode ? 'name' : 'message.inputs.query') || (!isChatMode ? (get(log, 'message.query') || get(log, 'message.inputs.default_input')) : '') || ''
            const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')
            return <tr
              key={log.id}
              className={cn('cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover', activeConversationId !== log.id ? '' : 'bg-background-default-hover')}
              onClick={() => handleRowClick(log)}>
              <td className='h-4'>
                {!log.read_at && (
                  <div className='flex items-center p-3 pr-0.5'>
                    <span className='inline-block h-1.5 w-1.5 rounded bg-util-colors-blue-blue-500'></span>
                  </div>
                )}
              </td>
              <td className='w-[160px] p-3 pr-2' style={{ maxWidth: isChatMode ? 300 : 200 }}>
                {renderTdValue(leftValue || t('appLog.table.empty.noChat'), !leftValue, isChatMode && log.annotated)}
              </td>
              <td className='p-3 pr-2'>{renderTdValue(endUser || defaultValue, !endUser)}</td>
              {isChatflow && <td className='w-[160px] p-3 pr-2' style={{ maxWidth: isChatMode ? 300 : 200 }}>
                {statusTdRender(log.status_count)}
              </td>}
              <td className='p-3 pr-2' style={{ maxWidth: isChatMode ? 100 : 200 }}>
                {renderTdValue(rightValue === 0 ? 0 : (rightValue || t('appLog.table.empty.noOutput')), !rightValue, !isChatMode && !!log.annotation?.content, log.annotation)}
              </td>
              <td className='p-3 pr-2'>
                {(!log.user_feedback_stats.like && !log.user_feedback_stats.dislike)
                  ? renderTdValue(defaultValue, true)
                  : <>
                    {!!log.user_feedback_stats.like && <HandThumbIconWithCount iconType='up' count={log.user_feedback_stats.like} />}
                    {!!log.user_feedback_stats.dislike && <HandThumbIconWithCount iconType='down' count={log.user_feedback_stats.dislike} />}
                  </>
                }
              </td>
              <td className='p-3 pr-2'>
                {(!log.admin_feedback_stats.like && !log.admin_feedback_stats.dislike)
                  ? renderTdValue(defaultValue, true)
                  : <>
                    {!!log.admin_feedback_stats.like && <HandThumbIconWithCount iconType='up' count={log.admin_feedback_stats.like} />}
                    {!!log.admin_feedback_stats.dislike && <HandThumbIconWithCount iconType='down' count={log.admin_feedback_stats.dislike} />}
                  </>
                }
              </td>
              <td className='w-[160px] p-3 pr-2'>{formatTime(log.updated_at, t('appLog.dateTimeFormat') as string)}</td>
              <td className='w-[160px] p-3 pr-2'>{formatTime(log.created_at, t('appLog.dateTimeFormat') as string)}</td>
            </tr>
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassName='mt-16 mx-2 sm:mr-2 mb-4 !p-0 !max-w-[640px] rounded-xl bg-components-panel-bg'
      >
        <DrawerContext.Provider value={{
          onClose: onCloseDrawer,
          appDetail,
        }}>
          {isChatMode
            ? <ChatConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />
            : <CompletionConversationDetailComp appId={appDetail.id} conversationId={currentConversation?.id} />
          }
        </DrawerContext.Provider>
      </Drawer>
    </div>
  )
}

export default ConversationList
