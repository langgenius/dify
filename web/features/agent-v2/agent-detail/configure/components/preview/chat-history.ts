import type {
  AgentThought,
  MessageDetailResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { FeedbackType, IChatItem, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { MessageRating } from '@/models/log'
import type { TransferMethod } from '@/types/app'
import type { FileResponse } from '@/types/workflow'
import { buildChatItemTree } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'

const toFileResponse = (
  file: NonNullable<MessageDetailResponse['message_files']>[number],
): FileResponse => ({
  related_id: file.id ?? file.upload_file_id,
  extension: '',
  filename: file.filename,
  size: file.size ?? 0,
  mime_type: file.mime_type ?? '',
  transfer_method: file.transfer_method as TransferMethod,
  type: file.type,
  url: file.url ?? '',
  upload_file_id: file.upload_file_id ?? '',
  remote_url: file.url ?? '',
})

const toLogMessages = (
  message: MessageDetailResponse['message'],
  answer: string,
  files: MessageDetailResponse['message_files'],
) => {
  if (!Array.isArray(message)) return []

  const logMessages = message as IChatItem['log']
  if (logMessages?.at(-1)?.role === 'assistant') return logMessages

  return [
    ...(logMessages ?? []),
    {
      role: 'assistant',
      text: answer,
      files: getProcessedFilesFromResponse(
        (files?.filter((file) => file.belongs_to === 'assistant') || []).map(toFileResponse),
      ),
    },
  ]
}

function toToolLabels(value: AgentThought['tool_labels']): ThoughtItem['tool_labels'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const toolLabels: NonNullable<ThoughtItem['tool_labels']> = {}
  for (const [name, label] of Object.entries(value)) {
    if (!label || typeof label !== 'object' || Array.isArray(label)) continue

    const enUS = 'en_US' in label ? label.en_US : undefined
    const zhHans = 'zh_Hans' in label ? label.zh_Hans : undefined
    if (typeof enUS !== 'string' || typeof zhHans !== 'string') continue

    toolLabels[name] = { en_US: enUS, zh_Hans: zhHans }
    for (const [locale, localizedLabel] of Object.entries(label)) {
      if (typeof localizedLabel === 'string') toolLabels[name][locale] = localizedLabel
    }
  }

  return Object.keys(toolLabels).length ? toolLabels : undefined
}

const toAgentThoughtItem = (thought: AgentThought, conversationId: string): ThoughtItem => ({
  id: thought.id,
  tool: thought.tool ?? '',
  thought: thought.thought ?? '',
  answer: thought.answer ?? '',
  tool_input: thought.tool_input ?? '',
  tool_labels: toToolLabels(thought.tool_labels),
  message_id: thought.message_id,
  conversation_id: conversationId,
  observation: thought.observation ?? '',
  position: thought.position,
  files: thought.files,
})

const toFeedback = (
  feedback: NonNullable<MessageDetailResponse['feedbacks']>[number] | undefined,
): FeedbackType | undefined => {
  if (!feedback) return undefined

  const rating = feedback.rating as MessageRating
  if (rating !== 'like' && rating !== 'dislike' && rating !== null) return undefined

  return {
    rating,
    content: feedback.content,
  }
}

export function getFormattedAgentDebugChatTree(
  messages: MessageDetailResponse[],
): ChatItemInTree[] {
  const chatList: IChatItem[] = []

  messages.forEach((item) => {
    const answer = item.answer ?? ''
    const questionFiles = item.message_files?.filter((file) => file.belongs_to === 'user') || []
    const answerFiles = item.message_files?.filter((file) => file.belongs_to === 'assistant') || []
    const answerTokens = item.answer_tokens ?? 0
    const messageTokens = item.message_tokens ?? 0
    const latency = item.provider_response_latency ?? 0

    chatList.push({
      id: `question-${item.id}`,
      content: item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map(toFileResponse)),
      parentMessageId: item.parent_message_id || undefined,
    })
    chatList.push({
      id: item.id,
      content: answer,
      agent_thoughts: addFileInfos(
        sortAgentSorts(
          (item.agent_thoughts ?? []).map((thought) =>
            toAgentThoughtItem(thought, item.conversation_id),
          ),
        ),
        item.message_files as unknown as FileEntity[],
      ),
      feedback: toFeedback(item.feedbacks?.find((feedback) => feedback.from_source === 'user')),
      isAnswer: true,
      log: toLogMessages(item.message, answer, item.message_files),
      message_files: getProcessedFilesFromResponse(answerFiles.map(toFileResponse)),
      parentMessageId: `question-${item.id}`,
      workflow_run_id: item.workflow_run_id ?? undefined,
      conversationId: item.conversation_id,
      input: {
        inputs: item.inputs,
        query: item.query,
      },
      more: {
        time: '',
        tokens: answerTokens + messageTokens,
        latency: latency.toFixed(2),
        tokens_per_second: latency > 0 ? (answerTokens / latency).toFixed(2) : undefined,
      },
    })
  })

  return buildChatItemTree(chatList)
}
