import type { MessageDetailResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ChatItemInTree } from '../../base/chat/types'
import type {
  CitationItem,
  FeedbackType,
  IChatItem,
  ThoughtItem,
} from '@/app/components/base/chat/chat/type'
import type { Annotation } from '@/models/log'
import type { VisionFile } from '@/types/app'
import type { FileResponse } from '@/types/workflow'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { get } from 'es-toolkit/compat'
import { isPlainObject } from 'es-toolkit/predicate'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { TransferMethod } from '@/types/app'

dayjs.extend(utc)
dayjs.extend(timezone)

type LogDetailMessage = {
  answer?: string | number | null
  inputs?: Record<string, unknown>
  message_files?: Array<{ url?: string | null }>
  query?: string
}

type ConversationLogDetail = {
  from_account_name?: string | null
  from_end_user_session_id?: string | null
  message?: LogDetailMessage | null
  message_count?: number
  model_config?: {
    // Untyped JSON in the console API response.
    user_input_form?: unknown
  } | null
  name?: string
}

const getUserInputVariable = (item: unknown) => {
  if (!isPlainObject(item)) return undefined
  const field = Object.values(item)[0]
  const variable = isPlainObject(field) ? field.variable : undefined

  return typeof variable === 'string' ? variable : undefined
}

type LogMessage = MessageDetailResponse

const isTransferMethod = (value: string): value is TransferMethod =>
  (Object.values(TransferMethod) as string[]).includes(value)

// Agent thoughts keep raw message files; the agent content renderer converts them once.
const toThoughtFiles = (item: LogMessage): VisionFile[] =>
  item.message_files.map((file) => ({
    id: file.id,
    type: file.type,
    transfer_method: isTransferMethod(file.transfer_method)
      ? file.transfer_method
      : TransferMethod.local_file,
    url: file.url ?? '',
    upload_file_id: file.upload_file_id ?? '',
    belongs_to: file.belongs_to ?? undefined,
  }))

const toFileResponse = (file: LogMessage['message_files'][number]): FileResponse => ({
  related_id: file.id ?? file.upload_file_id,
  extension: '',
  filename: '',
  size: 0,
  mime_type: '',
  transfer_method: isTransferMethod(file.transfer_method)
    ? file.transfer_method
    : TransferMethod.local_file,
  type: file.type,
  url: file.url ?? '',
  upload_file_id: file.upload_file_id ?? '',
  remote_url: file.url ?? '',
})

const toText = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

// `inputs` values are untyped JSON in the console API response.
export const getStringInputs = (inputs: LogMessage['inputs']) =>
  Object.fromEntries(
    Object.entries(inputs).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )

const toFeedback = (feedback?: LogMessage['feedbacks'][number]): FeedbackType | undefined =>
  feedback?.rating === 'like' || feedback?.rating === 'dislike'
    ? { rating: feedback.rating, content: feedback.content }
    : undefined

const toThoughtItems = (message: LogMessage): ThoughtItem[] =>
  message.agent_thoughts.map((thought) => ({
    id: thought.id,
    tool: thought.tool ?? '',
    thought: thought.thought ?? '',
    answer: thought.answer ?? undefined,
    tool_input: thought.tool_input ?? '',
    // `tool_labels` is untyped JSON in the console API response.
    tool_labels: isPlainObject(thought.tool_labels)
      ? (thought.tool_labels as ThoughtItem['tool_labels'])
      : undefined,
    message_id: thought.message_id,
    conversation_id: message.conversation_id,
    observation: thought.observation ?? '',
    position: thought.position,
    files: thought.files,
  }))

// `message` and `metadata` are untyped JSON in the console API response.
const getPromptLog = (message: LogMessage) =>
  (Array.isArray(message.message) ? message.message : []) as NonNullable<IChatItem['log']>

const getCitations = (message: LogMessage) =>
  isPlainObject(message.metadata) && Array.isArray(message.metadata.retriever_resources)
    ? (message.metadata.retriever_resources as CitationItem[])
    : undefined

const getAnnotation = (message: LogMessage): Annotation | undefined => {
  if (message.annotation_hit_history) {
    return {
      id: message.annotation_hit_history.annotation_id,
      authorName: message.annotation_hit_history.annotation_create_account?.name || 'N/A',
      created_at: message.annotation_hit_history.created_at ?? undefined,
    }
  }

  if (message.annotation) {
    const { account } = message.annotation
    return {
      id: message.annotation.id,
      authorName: account?.name || 'N/A',
      logAnnotation: {
        id: message.annotation.id,
        content: message.annotation.content,
        account: { id: account?.id ?? '', name: account?.name ?? '', email: account?.email ?? '' },
        created_at: message.annotation.created_at ?? 0,
      },
      created_at: 0,
    }
  }

  return undefined
}

export const getFormattedChatList = (
  messages: LogMessage[],
  conversationId: string,
  timezone: string,
  format: string,
) => {
  const newChatList: IChatItem[] = []

  messages.forEach((item) => {
    const questionFiles = getProcessedFilesFromResponse(
      item.message_files.filter((file) => file.belongs_to === 'user').map(toFileResponse),
    )
    newChatList.push({
      id: `question-${item.id}`,
      content: toText(item.inputs.query) || toText(item.inputs.default_input) || item.query,
      isAnswer: false,
      message_files: questionFiles,
      parentMessageId: item.parent_message_id || undefined,
    })

    const answerFiles = getProcessedFilesFromResponse(
      item.message_files.filter((file) => file.belongs_to === 'assistant').map(toFileResponse),
    )
    const promptLog = getPromptLog(item)
    newChatList.push({
      id: item.id,
      content: item.answer,
      agent_thoughts: addFileInfos(sortAgentSorts(toThoughtItems(item)), toThoughtFiles(item)),
      feedback: toFeedback(item.feedbacks.find((feedback) => feedback.from_source === 'user')),
      adminFeedback: toFeedback(
        item.feedbacks.find((feedback) => feedback.from_source === 'admin'),
      ),
      feedbackDisabled: false,
      isAnswer: true,
      message_files: answerFiles,
      log: [
        ...promptLog,
        ...(promptLog.at(-1)?.role !== 'assistant'
          ? [{ role: 'assistant', text: item.answer, files: answerFiles }]
          : []),
      ],
      workflow_run_id: item.workflow_run_id ?? undefined,
      conversationId,
      input: {
        inputs: item.inputs,
        query: item.query,
      },
      more: {
        time: item.created_at ? dayjs.unix(item.created_at).tz(timezone).format(format) : '',
        tokens: item.answer_tokens + item.message_tokens,
        latency: (item.provider_response_latency ?? 0).toFixed(2),
      },
      citation: getCitations(item),
      annotation: getAnnotation(item),
      parentMessageId: `question-${item.id}`,
    })
  })

  return newChatList
}

export const mergeUniqueChatItems = (prevItems: IChatItem[], newItems: IChatItem[]) => {
  const existingIds = new Set(prevItems.map((item) => item.id))
  const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id))

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
  const existingIds = new Set(prevItems.map((item) => item.id))
  const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id))

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
    chatItemTree = [
      {
        id: 'introduction',
        isAnswer: true,
        isOpeningStatement: true,
        content: introduction,
        feedbackDisabled: true,
        children: chatItemTree,
      },
    ]
  }

  const lastMessageId = allChatItems[allChatItems.length - 1]?.id
  const threadChatItems = getThreadMessages(chatItemTree, lastMessageId)
  const oldestAnswerId = allChatItems.find((item) => item.isAnswer)?.id

  return {
    chatItemTree,
    oldestAnswerId,
    threadChatItems,
  }
}

export const getThreadChatItems = (chatItemTree: ChatItemInTree[], siblingMessageId: string) =>
  getThreadMessages(chatItemTree, siblingMessageId)

export const applyAnnotationEdited = (
  items: IChatItem[],
  query: string,
  answer: string,
  index: number,
) =>
  items.map((item, currentIndex) => {
    if (currentIndex === index - 1) return { ...item, content: query }

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

export const applyAnnotationAdded = (
  items: IChatItem[],
  annotationId: string,
  authorName: string,
  query: string,
  answer: string,
  index: number,
) =>
  items.map((item, currentIndex) => {
    if (currentIndex === index - 1) return { ...item, content: query }

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

export const applyAnnotationRemoved = (items: IChatItem[], index: number) =>
  items.map((item, currentIndex) => {
    if (currentIndex === index) return { ...item, annotation: undefined }

    return item
  })
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
  const rawLeftValue: unknown =
    get(log, isChatMode ? 'name' : 'message.inputs.query') ||
    (!isChatMode ? get(log, 'message.query') || get(log, 'message.inputs.default_input') : '') ||
    ''
  const leftValue =
    typeof rawLeftValue === 'string' || typeof rawLeftValue === 'number' ? rawLeftValue : ''
  const rightValue = get(log, isChatMode ? 'message_count' : 'message.answer')

  return {
    endUser,
    isLeftEmpty: !leftValue,
    isRightEmpty: !rightValue,
    leftValue: leftValue || noChatLabel,
    rightValue: rightValue === 0 ? 0 : rightValue || noOutputLabel,
  }
}

export const getDetailVarList = (
  detail: ConversationLogDetail,
  varValues: Record<string, string>,
) => {
  const userInputForm = detail.model_config?.user_input_form
  if (!Array.isArray(userInputForm)) return []

  return userInputForm.flatMap((item) => {
    const variable = getUserInputVariable(item)

    if (!variable) return []

    const value = varValues[variable] ?? detail.message?.inputs?.[variable]

    if (typeof value !== 'string') return []

    return [
      {
        label: variable,
        value,
      },
    ]
  })
}

export const getCompletionMessageFiles = (detail: ConversationLogDetail, isChatMode: boolean) => {
  const messageFiles = detail.message?.message_files

  if (isChatMode || !messageFiles?.length) return []

  return messageFiles.flatMap((item) => (item.url ? [item.url] : []))
}

// `model_config.model` is untyped JSON in the console API response.
export const getLogModelInfo = (model: unknown) => {
  if (!isPlainObject(model)) return undefined
  const { name, provider, completion_params } = model
  if (typeof name !== 'string' || typeof provider !== 'string') return undefined

  return {
    name,
    provider,
    completion_params: isPlainObject(completion_params) ? completion_params : undefined,
  }
}

export const getAdminFeedback = (
  feedbacks: Array<{ content?: string | null; from_source: string; rating: string }>,
): FeedbackType | undefined => {
  const feedback = feedbacks.find((item) => item.from_source === 'admin')
  if (feedback?.rating !== 'like' && feedback?.rating !== 'dislike') return undefined

  return { rating: feedback.rating, content: feedback.content }
}
