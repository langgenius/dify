import type { MessageDetailResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { FeedbackType, IChatItem } from '@/app/components/base/chat/chat/type'
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import type { MessageRating } from '@/models/log'
import { buildChatItemTree } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { addFileInfos, sortAgentSorts } from '@/app/components/tools/utils'
import { toAgentMessageFileResponse, toAgentThoughtItem } from '../../../agent-thoughts'

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
        (files?.filter((file) => file.belongs_to === 'assistant') || []).map(
          toAgentMessageFileResponse,
        ),
      ),
    },
  ]
}

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
      message_files: getProcessedFilesFromResponse(questionFiles.map(toAgentMessageFileResponse)),
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
        getProcessedFilesFromResponse((item.message_files ?? []).map(toAgentMessageFileResponse)),
      ),
      feedback: toFeedback(item.feedbacks?.find((feedback) => feedback.from_source === 'user')),
      isAnswer: true,
      log: toLogMessages(item.message, answer, item.message_files),
      message_files: getProcessedFilesFromResponse(answerFiles.map(toAgentMessageFileResponse)),
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
