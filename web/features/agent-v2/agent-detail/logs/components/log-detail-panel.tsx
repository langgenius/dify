import type {
  AgentLogConversationItemResponse,
  AgentLogMessageItemResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig, OnFeedback } from '@/app/components/base/chat/types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Chat from '@/app/components/base/chat/chat'
import CopyIcon from '@/app/components/base/copy-icon'
import Loading from '@/app/components/base/loading'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'

export function AgentLogDetailPanel({
  agentId,
  log,
  onClose,
}: {
  agentId: string
  log?: AgentLogConversationItemResponse
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const feedbackMutation = useMutation(
    consoleQuery.agent.byAgentId.feedbacks.post.mutationOptions(),
  )
  const messagesQuery = useQuery(
    consoleQuery.agent.byAgentId.logs.byConversationId.messages.get.queryOptions({
      input: log
        ? {
            params: {
              agent_id: agentId,
              conversation_id: log.conversation_id,
            },
            query: {
              limit: 100,
              page: 1,
              sort_by: 'created_at',
              sort_order: 'asc',
              ...(log.source ? { sources: [log.source.id] } : {}),
            },
          }
        : skipToken,
    }),
  )
  const chatList = log
    ? formatAgentLogMessages({
        conversationId: log.conversation_id,
        formatLogTime: (value) =>
          formatTime(
            value,
            tAgentV2(($) => $['roster.dateTimeFormat']),
          ),
        messages: messagesQuery.data?.data ?? [],
      })
    : []
  const handleFeedback: OnFeedback = async (messageId, feedback) => {
    try {
      await feedbackMutation.mutateAsync({
        params: { agent_id: agentId },
        body: {
          message_id: messageId,
          rating: feedback.rating,
          content: feedback.content,
        },
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.logs.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.logs.byConversationId.messages.get.key(),
        }),
      ])
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
    } catch (error) {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      throw error
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border-[0.5px] border-components-panel-border">
      <div className="flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pt-3 pr-3 pb-2 pl-4">
        <div className="min-w-0 shrink-0">
          <div className="mb-0.5 system-xs-semibold-uppercase text-text-primary">
            {log?.source?.type === 'workflow'
              ? tAgentV2(($) => $['agentDetail.logs.executionId'])
              : t(($) => $['detail.conversationId'], { ns: 'appLog' })}
          </div>
          <div className="flex min-w-0 items-center system-2xs-regular-uppercase text-text-secondary">
            {log && (
              <>
                <Tooltip>
                  <TooltipTrigger render={<div className="truncate">{log.conversation_id}</div>} />
                  <TooltipContent>{log.conversation_id}</TooltipContent>
                </Tooltip>
                <CopyIcon content={log.conversation_id} />
              </>
            )}
          </div>
        </div>
        <div className="flex min-w-0 grow flex-wrap items-center justify-end gap-y-1">
          <div className="min-w-0 truncate system-sm-medium text-text-secondary">
            {log?.title || log?.conversation_id}
          </div>
        </div>
        <IconButton
          size="lg"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </IconButton>
      </div>
      <div className="shrink-0 px-1 pt-1">
        <div className="rounded-t-xl bg-background-section-burn p-3 pb-2" />
      </div>
      <div className="mx-1 mb-1 grow overflow-auto rounded-b-xl bg-background-section-burn">
        {messagesQuery.isPending && (
          <div className="flex h-full items-center justify-center">
            <Loading />
          </div>
        )}
        {messagesQuery.isError && (
          <div className="flex h-full items-center justify-center text-center system-sm-regular text-text-tertiary">
            {t(($) => $['agentDetail.logs.loadFailed'], { ns: 'agentV2' })}
          </div>
        )}
        {messagesQuery.isSuccess && chatList.length === 0 && (
          <div className="flex h-full items-center justify-center text-center system-sm-regular text-text-tertiary">
            {t(($) => $['agentDetail.logs.empty'], { ns: 'agentV2' })}
          </div>
        )}
        {messagesQuery.isSuccess && chatList.length > 0 && (
          <div className="mb-4 pt-4">
            <Chat
              config={
                {
                  supportAnnotation: true,
                  supportFeedback: log?.source?.type === 'webapp',
                } as ChatConfig
              }
              chatList={chatList}
              noChatInput
              hideProcessDetail
              hideLogModal
              chatContainerInnerClassName="px-3"
              onFeedback={handleFeedback}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function formatAgentLogMessages({
  conversationId,
  formatLogTime,
  messages,
}: {
  conversationId: string
  formatLogTime: (value: number) => string
  messages: AgentLogMessageItemResponse[]
}) {
  const chatList: IChatItem[] = []

  messages.forEach((message) => {
    const userFeedback = message.feedbacks?.find((feedback) => feedback.from_source === 'user')
    const adminFeedback = message.feedbacks?.find((feedback) => feedback.from_source === 'admin')
    chatList.push({
      id: `question-${message.id}`,
      content: message.query,
      isAnswer: false,
      parentMessageId: undefined,
    })
    chatList.push({
      id: message.id,
      content: message.answer || message.error || '',
      conversationId,
      feedback: userFeedback,
      adminFeedback,
      feedbackDisabled: !message.feedback_enabled,
      input: {
        inputs: {
          query: message.query,
        },
        query: message.query,
      },
      isAnswer: true,
      log: [
        { role: 'user', text: message.query },
        { role: 'assistant', text: message.answer || message.error || '' },
      ],
      more: {
        latency: message.latency.toFixed(2),
        time: formatLogTime(message.created_at ?? message.updated_at ?? 0),
        tokens: message.total_tokens,
      },
      parentMessageId: `question-${message.id}`,
    })
  })

  return chatList
}
