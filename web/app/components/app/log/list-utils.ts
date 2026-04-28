import type { ChatItemInTree } from '../../base/chat/types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { Annotation, ChatMessage } from '@/models/log'
import type { FileResponse } from '@/types/workflow'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { get } from 'es-toolkit/compat'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'

dayjs.extend(utc)
dayjs.extend(timezone)

type LogDetailMessage = {
  answer?: string | number | null
  inputs?: Record<string, string>
  message_files?: Array<{ url?: string }>
  query?: string
}

type UserInputFormItem = Record<string, { variable?: string }>

type ConversationLogDetail = {
  from_account_name?: string
  from_end_user_session_id?: string
  message?: LogDetailMessage
  message_count?: number
  model_config?: {
    user_input_form?: UserInputFormItem[]
  }
  name?: string
}

type ConversationFeedbackStats = {
  dislike?: number
  like?: number
}

const getUserInputVariable = (item: UserInputFormItem) => {
  const variable = Object.values(item)[0]?.variable

  return typeof variable === 'string' ? variable : undefined
}

const toFileResponse = (file: NonNullable<ChatMessage['message_files']>[number]): FileResponse => ({
  related_id: file.id ?? file.upload_file_id,
  extension: '',
  filename: '',
  size: 0,
  mime_type: '',
  transfer_method: file.transfer_method,
  type: file.type,
  url: file.url,
  upload_file_id: file.upload_file_id,
  remote_url: file.url,
})

export const getFormattedChatList = (messages: ChatMessage[], conversationId: string, timezone: string, format: string) => {
  const newChatList: IChatItem[] = []

  messages.forEach((item: ChatMessage) => {
    const questionFiles = item.message_files?.filter(file => file.belongs_to === 'user') || []
    newChatList.push({
      id: `question-${item.id}`,
      content: item.inputs.query || item.inputs.default_input || item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map(toFileResponse)),
      parentMessageId: item.parent_message_id || undefined,
    })

    const answerFiles = item.message_files?.filter(file => file.belongs_to === 'assistant') || []
    newChatList.push({
      id: item.id,
      content: item.answer,
      agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
      feedback: item.feedbacks?.find(feedback => feedback.from_source === 'user'),
      adminFeedback: item.feedbacks?.find(feedback => feedback.from_source === 'admin'),
      feedbackDisabled: false,
      isAnswer: true,
      message_files: getProcessedFilesFromResponse(answerFiles.map(toFileResponse)),
      log: [
        ...(item.message ?? []),
        ...(item.message?.[item.message.length - 1]?.role !== 'assistant'
          ? [{
              role: 'assistant',
              text: item.answer,
              files: item.message_files?.filter(file => file.belongs_to === 'assistant') || [],
            }]
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
        latency: (item.provider_response_latency ?? 0).toFixed(2),
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

export const mergeUniqueChatItems = (prevItems: IChatItem[], newItems: IChatItem[]) => {
  const existingIds = new Set(prevItems.map(item => item.id))
  const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id))

  return [...uniqueNewItems, ...prevItems]
}

export const mergePaginatedChatItems = ({
  maxRetryCount,
  newItems,
  prevItems,
  retryCount,
}: {
  maxRetryCount: number
  newItems: IChatItem[]
  prevItems: IChatItem[]
  retryCount: number
}) => {
  const existingIds = new Set(prevItems.map(item => item.id))
  const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id))

  if (!uniqueNewItems.length) {
    if (retryCount < maxRetryCount && prevItems.length > 1) {
      return {
        items: prevItems,
        retryCount: retryCount + 1,
      }
    }

    return {
      items: prevItems,
      retryCount: 0,
    }
  }

  return {
    items: [...uniqueNewItems, ...prevItems],
    retryCount: 0,
  }
}

export const buildChatThreadState = ({
  allChatItems,
  hasMore,
  introduction,
}: {
  allChatItems: IChatItem[]
  hasMore: boolean
  introduction?: string
}) => {
  if (!allChatItems.length) {
    return {
      chatItemTree: [] as ChatItemInTree[],
      oldestAnswerId: undefined as string | undefined,
      threadChatItems: [] as IChatItem[],
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

  const lastMessageId = allChatItems[allChatItems.length - 1]?.id
  const threadChatItems = getThreadMessages(chatItemTree, lastMessageId)
  const oldestAnswerId = allChatItems.find(item => item.isAnswer)?.id

  return {
    chatItemTree,
    oldestAnswerId,
    threadChatItems,
  }
}

export const getThreadChatItems = (chatItemTree: ChatItemInTree[], siblingMessageId: string) =>
  getThreadMessages(chatItemTree, siblingMessageId)

export const applyAnnotationEdited = (items: IChatItem[], query: string, answer: string, index: number) => items.map((item, currentIndex) => {
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

export const applyAnnotationAdded = (items: IChatItem[], annotationId: string, authorName: string, query: string, answer: string, index: number) => items.map((item, currentIndex) => {
  if (currentIndex === index - 1)
    return { ...item, content: query }

  if (currentIndex === index) {
    return {
      ...item,
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

export const applyAnnotationRemoved = (items: IChatItem[], index: number) => items.map((item, currentIndex) => {
  if (currentIndex === index)
    return { ...item, annotation: undefined }

  return item
})

export const buildConversationUrl = (pathname: string, searchParams: string, conversationId?: string) => {
  const params = new URLSearchParams(searchParams)
  if (conversationId)
    params.set('conversation_id', conversationId)
  else
    params.delete('conversation_id')

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

export const isNearTopLoadMore = ({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}) => Math.abs(scrollTop) > scrollHeight - clientHeight - 40

export const getConversationRowValues = ({
  isChatMode,
  log,
  noChatLabel,
  noOutputLabel,
}: {
  isChatMode: boolean
  log: ConversationLogDetail
  noChatLabel: string
  noOutputLabel: string
}) => {
  const endUser = log.from_end_user_session_id || log.from_account_name
  const leftValue = get(log, isChatMode ? 'name' : 'message.inputs.query')
    || (!isChatMode ? (get(log, 'message.query') || get(log, 'message.inputs.default_input')) : '')
    || ''
  const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')

  return {
    endUser,
    isLeftEmpty: !leftValue,
    isRightEmpty: !rightValue,
    leftValue: leftValue || noChatLabel,
    rightValue: rightValue === 0 ? 0 : (rightValue || noOutputLabel),
  }
}

export const getDetailVarList = (detail: ConversationLogDetail, varValues: Record<string, string>) =>
  detail.model_config?.user_input_form?.flatMap((item) => {
    const variable = getUserInputVariable(item)

    if (!variable)
      return []

    const value = varValues[variable] ?? detail.message?.inputs?.[variable]

    if (typeof value !== 'string')
      return []

    return [{
      label: variable,
      value,
    }]
  }) || []

export const getCompletionMessageFiles = (detail: ConversationLogDetail, isChatMode: boolean) => {
  const messageFiles = detail.message?.message_files

  if (isChatMode || !messageFiles?.length)
    return []

  return messageFiles.flatMap(item => item.url ? [item.url] : [])
}

export const hasConversationFeedback = (stats?: ConversationFeedbackStats | null) =>
  Boolean(stats?.like || stats?.dislike)
