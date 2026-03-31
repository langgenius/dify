import type { ChatItemInTree } from '../../base/chat/types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type {
  Annotation,
  ChatConversationFullDetailResponse,
  ChatConversationGeneralDetail,
  ChatConversationsResponse,
  ChatMessage,
  CompletionConversationFullDetailResponse,
  CompletionConversationGeneralDetail,
  CompletionConversationsResponse,
  LogAnnotation,
} from '@/models/log'
import type { FileResponse } from '@/types/workflow'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { get } from 'es-toolkit/compat'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { AppModeEnum } from '@/types/app'

dayjs.extend(utc)
dayjs.extend(timezone)

export type ConversationListItem = ChatConversationGeneralDetail | CompletionConversationGeneralDetail
export type ConversationSelection = ConversationListItem | { id: string, isPlaceholder?: true }
export type ConversationLogs = ChatConversationsResponse | CompletionConversationsResponse
export type ConversationDetail = ChatConversationFullDetailResponse | CompletionConversationFullDetailResponse

export type StatusCount = {
  paused: number
  success: number
  failed: number
  partial_success: number
}

type UserInputField = Record<string, {
  variable: string
}>

export const DEFAULT_EMPTY_VALUE = 'N/A'
export const MIN_ITEMS_FOR_SCROLL_LOADING = 8
export const SCROLL_DEBOUNCE_MS = 200
export const MAX_RETRY_COUNT = 3

export const mergeUniqueChatItems = (prevItems: IChatItem[], newItems: IChatItem[]) => {
  const existingIds = new Set(prevItems.map(item => item.id))
  const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id))

  return {
    mergedItems: [...uniqueNewItems, ...prevItems],
    uniqueNewItems,
  }
}

export const getNextRetryCount = (uniqueNewItemsLength: number, prevItemsLength: number, currentRetryCount: number, maxRetryCount = MAX_RETRY_COUNT) => {
  if (uniqueNewItemsLength > 0)
    return 0

  if (currentRetryCount < maxRetryCount && prevItemsLength > 1)
    return currentRetryCount + 1

  return 0
}

export const shouldThrottleLoad = (now: number, lastLoadTime: number, debounceMs = SCROLL_DEBOUNCE_MS) => {
  return now - lastLoadTime < debounceMs
}

export const isReverseScrollNearTop = (scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 40) => {
  return Math.abs(scrollTop) > scrollHeight - clientHeight - threshold
}

export const buildConversationUrl = (pathname: string, searchParams: URLSearchParams | { toString: () => string }, conversationId?: string) => {
  const params = new URLSearchParams(searchParams.toString())
  if (conversationId)
    params.set('conversation_id', conversationId)
  else
    params.delete('conversation_id')

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

export const resolveConversationSelection = (logs: ConversationLogs | undefined, conversationIdInUrl: string, pendingConversation: ConversationSelection | undefined) => {
  const matchedConversation = logs?.data?.find((item: ConversationListItem) => item.id === conversationIdInUrl)
  return matchedConversation ?? pendingConversation ?? { id: conversationIdInUrl, isPlaceholder: true }
}

export const getFormattedChatList = (messages: ChatMessage[], conversationId: string, userTimezone: string, format: string) => {
  const newChatList: IChatItem[] = []

  messages.forEach((item) => {
    const questionFiles = item.message_files?.filter(file => file.belongs_to === 'user') ?? []
    newChatList.push({
      id: `question-${item.id}`,
      content: item.inputs.query || item.inputs.default_input || item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map(file => ({ ...file, related_id: file.id })) as FileResponse[]),
      parentMessageId: item.parent_message_id || undefined,
    })

    const answerFiles = item.message_files?.filter(file => file.belongs_to === 'assistant') ?? []
    const existingLog = item.message ?? []
    const normalizedLog = existingLog.at(-1)?.role === 'assistant'
      ? existingLog
      : [
          ...existingLog,
          {
            role: 'assistant' as const,
            text: item.answer,
            files: answerFiles,
          },
        ]

    newChatList.push({
      id: item.id,
      content: item.answer,
      agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
      feedback: item.feedbacks?.find(feedback => feedback.from_source === 'user'),
      adminFeedback: item.feedbacks?.find(feedback => feedback.from_source === 'admin'),
      feedbackDisabled: false,
      isAnswer: true,
      message_files: getProcessedFilesFromResponse(answerFiles.map(file => ({ ...file, related_id: file.id })) as FileResponse[]),
      log: normalizedLog as IChatItem['log'],
      workflow_run_id: item.workflow_run_id,
      conversationId,
      input: {
        inputs: item.inputs,
        query: item.query,
      },
      more: {
        time: dayjs.unix(item.created_at).tz(userTimezone).format(format),
        tokens: item.answer_tokens + item.message_tokens,
        latency: (item.provider_response_latency ?? 0).toFixed(2),
      },
      citation: item.metadata?.retriever_resources,
      annotation: item.annotation_hit_history
        ? {
            id: item.annotation_hit_history.annotation_id,
            authorName: item.annotation_hit_history.annotation_create_account?.name || DEFAULT_EMPTY_VALUE,
            created_at: item.annotation_hit_history.created_at,
          }
        : item.annotation
          ? {
              id: item.annotation.id,
              authorName: item.annotation.account.name,
              logAnnotation: item.annotation,
              created_at: 0,
            }
          : undefined,
      parentMessageId: `question-${item.id}`,
    })
  })

  return newChatList
}

export const buildChatState = (allChatItems: IChatItem[], hasMore: boolean, introduction?: string | null) => {
  if (allChatItems.length === 0) {
    return {
      chatItemTree: [] as ChatItemInTree[],
      threadChatItems: [] as IChatItem[],
      oldestAnswerId: undefined as string | undefined,
    }
  }

  let chatItemTree = buildChatItemTree(allChatItems)
  if (!hasMore && introduction) {
    chatItemTree = [{
      id: 'introduction',
      isAnswer: true,
      isOpeningStatement: true,
      content: introduction,
      feedbackDisabled: true,
      children: chatItemTree,
    }]
  }

  const lastMessageId = allChatItems.at(-1)?.id
  const threadChatItems = getThreadMessages(chatItemTree, lastMessageId)
  const oldestAnswerId = allChatItems.find(item => item.isAnswer)?.id

  return {
    chatItemTree,
    threadChatItems,
    oldestAnswerId,
  }
}

export const applyEditedAnnotation = (allChatItems: IChatItem[], query: string, answer: string, index: number) => {
  return allChatItems.map((item, currentIndex) => {
    if (currentIndex === index - 1)
      return { ...item, content: query }

    if (currentIndex === index) {
      return {
        ...item,
        annotation: {
          ...item.annotation,
          logAnnotation: {
            ...item.annotation?.logAnnotation,
            content: answer,
          },
        } as Annotation,
      }
    }

    return item
  })
}

export const applyAddedAnnotation = (allChatItems: IChatItem[], annotationId: string, authorName: string, query: string, answer: string, index: number) => {
  return allChatItems.map((item, currentIndex) => {
    if (currentIndex === index - 1)
      return { ...item, content: query }

    if (currentIndex === index) {
      return {
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
    }

    return item
  })
}

export const removeAnnotationFromChatItems = (allChatItems: IChatItem[], index: number) => {
  return allChatItems.map((item, currentIndex) => {
    if (currentIndex !== index)
      return item

    return {
      ...item,
      content: item.content,
      annotation: undefined,
    }
  })
}

export const buildDetailVarList = (detail: ConversationDetail, varValues: Record<string, string>) => {
  const userInputForm = ((detail.model_config as { user_input_form?: UserInputField[] })?.user_input_form) ?? []
  const detailInputs = 'message' in detail ? detail.message.inputs : undefined

  return userInputForm.map((item) => {
    const itemContent = item[Object.keys(item)[0]]
    return {
      label: itemContent.variable,
      value: varValues[itemContent.variable] || detailInputs?.[itemContent.variable],
    }
  })
}

export const getDetailMessageFiles = (appMode: AppModeEnum, detail: ConversationDetail) => {
  if (appMode !== AppModeEnum.COMPLETION || !('message' in detail) || !detail.message.message_files?.length)
    return []

  return detail.message.message_files.map(item => item.url)
}

export const getConversationRowValues = (log: ConversationListItem, isChatMode: boolean) => {
  const endUser = log.from_end_user_session_id || log.from_account_id
  const leftValue = get(log, isChatMode ? 'name' : 'message.inputs.query') || (!isChatMode ? (get(log, 'message.query') || get(log, 'message.inputs.default_input')) : '') || ''
  const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')

  return {
    endUser,
    leftValue,
    rightValue,
  }
}

export const getAnnotationTooltipText = (annotation: LogAnnotation | undefined, formattedTime: string, text: string) => {
  if (!annotation)
    return ''

  return `${text} ${formattedTime}`
}
