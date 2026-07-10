import type { AgentLogConversationItemResponse, AgentLogMessageItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
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
  const messagesQuery = useQuery(consoleQuery.agent.byAgentId.logs.byConversationId.messages.get.queryOptions({
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
  }))
  const chatList = log
    ? formatAgentLogMessages({
        conversationId: log.conversation_id,
        formatLogTime: value => formatTime(value, tAgentV2($ => $['roster.dateTimeFormat'])),
        messages: messagesQuery.data?.data ?? [],
      })
    : []

  return (
    <div className="flex h-full flex-col rounded-xl border-[0.5px] border-components-panel-border">
      <div className="flex shrink-0 items-center gap-2 rounded-t-xl bg-components-panel-bg pt-3 pr-3 pb-2 pl-4">
        <div className="min-w-0 shrink-0">
          <div className="mb-0.5 system-xs-semibold-uppercase text-text-primary">{t($ => $['detail.conversationId'], { ns: 'appLog' })}</div>
          <div className="flex min-w-0 items-center system-2xs-regular-uppercase text-text-secondary">
            {log && (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <div className="truncate">{log.conversation_id}</div>
                    )}
                  />
                  <TooltipContent>
                    {log.conversation_id}
                  </TooltipContent>
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
        <ActionButton size="l" aria-label={t($ => $['operation.close'], { ns: 'common' })} onClick={onClose}>
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </ActionButton>
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
            {t($ => $['agentDetail.logs.loadFailed'], { ns: 'agentV2' })}
          </div>
        )}
        {messagesQuery.isSuccess && chatList.length === 0 && (
          <div className="flex h-full items-center justify-center text-center system-sm-regular text-text-tertiary">
            {t($ => $['agentDetail.logs.empty'], { ns: 'agentV2' })}
          </div>
        )}
        {messagesQuery.isSuccess && chatList.length > 0 && (
          <div className="mb-4 pt-4">
            <Chat
              chatList={chatList}
              noChatInput
              showPromptLog
              hideProcessDetail
              hideLogModal
              chatContainerInnerClassName="px-3"
              onFeedback={noop}
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
      feedbackDisabled: true,
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
