'use client'

import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { consoleQuery } from '@/service/console'
import { AgentChatRuntime } from './chat-runtime'
import { sendPreviewChatMessage } from './preview-chat-request'
import { AgentUnconfiguredNotice } from './unconfigured-notice'

type AgentPreviewChatProps = Omit<
  AgentChatRuntimeProps,
  'draftType' | 'inputPlaceholder' | 'renderEmptyState' | 'sendMessage'
>

function AgentPreviewChatEmptyState({
  agentId,
  showUnconfiguredNotice,
}: AgentChatRuntimeEmptyStateProps & { agentId: AgentChatRuntimeProps['agentId'] }) {
  const { t } = useTranslation(['agentV2'])
  const { data: agent } = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const imageUrl =
    agent?.icon_type === 'image'
      ? agent.icon_url
      : agent?.icon_type === 'link'
        ? agent.icon
        : undefined
  const iconType = imageUrl ? 'image' : agent?.icon_type

  return (
    <>
      <AppIcon
        size="xxl"
        rounded
        iconType={iconType}
        icon={agent?.icon_type === 'emoji' ? (agent.icon ?? undefined) : undefined}
        background={agent?.icon_background}
        imageUrl={imageUrl}
        className="bg-background-default"
      />
      <div className="mt-3 max-w-full truncate system-md-medium text-text-secondary">
        {agent?.name || t(($) => $['agentDetail.configure.preview.empty.defaultAgentName'])}
      </div>
      <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.preview.empty.description'])}
      </p>
      <AgentUnconfiguredNotice visible={showUnconfiguredNotice} />
    </>
  )
}

export function AgentPreviewChat(props: AgentPreviewChatProps) {
  const { t } = useTranslation(['agentV2'])
  const agentName =
    props.agentName || t(($) => $['agentDetail.configure.preview.empty.defaultAgentName'])

  return (
    <AgentChatRuntime
      {...props}
      inputPlaceholder={t(($) => $['agentDetail.configure.preview.inputPlaceholder'], {
        name: agentName,
      })}
      sendMessage={sendPreviewChatMessage}
      renderEmptyState={(emptyStateProps) => (
        <AgentPreviewChatEmptyState {...emptyStateProps} agentId={props.agentId} />
      )}
    />
  )
}
